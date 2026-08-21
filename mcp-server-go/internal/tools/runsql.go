package tools

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RunSQL ports RetrievalTools.runSql: sanitize then execute, returning
// {"executedSql": ..., "rows": [...]} shaped exactly like jdbc.queryForList's output
// (list of column-name -> value maps).
func RunSQL(ctx context.Context, pool *pgxpool.Pool, sql string) (map[string]any, error) {
	safe, err := SanitizeSQL(sql)
	if err != nil {
		return nil, err
	}

	rows, err := pool.Query(ctx, safe)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var result []map[string]any
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(map[string]any, len(values))
		for i, v := range values {
			row[string(fieldDescs[i].Name)] = normalizePgValue(v)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if result == nil {
		result = []map[string]any{}
	}

	return map[string]any{
		"executedSql": safe,
		"rows":        result,
	}, nil
}

// normalizePgValue mirrors JdbcTemplate.queryForList's plain-Java-object row shape
// closely enough for JSON encoding purposes (pgx already returns Go-native types for
// numerics/strings/bools/times; pgx.Numeric/text arrays fall back to their String()
// form to keep JSON output stable).
func normalizePgValue(v any) any {
	if n, ok := v.(interface{ Value() (interface{}, error) }); ok {
		if val, err := n.Value(); err == nil {
			return val
		}
	}
	return v
}
