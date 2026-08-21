package sql

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// SchemaPromptFormatter ports SchemaPromptFormatter.kt 1:1: turns db://schema JSON into
// a compact TABLE/FOREIGN KEYS/KNOWN COLUMN VALUES/RULES textual block.
type SchemaPromptFormatter struct{}

func (f *SchemaPromptFormatter) Format(rawSchema string) string {
	var root map[string]any
	if err := json.Unmarshal([]byte(rawSchema), &root); err != nil {
		return rawSchema
	}

	tablesRaw, ok := root["tables"].(map[string]any)
	if !ok {
		return rawSchema
	}

	var sb strings.Builder
	sb.WriteString("DATABASE SCHEMA\n")

	tableNames := make([]string, 0, len(tablesRaw))
	for k := range tablesRaw {
		tableNames = append(tableNames, k)
	}
	sort.Strings(tableNames)

	for _, table := range tableNames {
		columns, _ := tablesRaw[table].([]any)
		colStrs := make([]string, len(columns))
		for i, c := range columns {
			colStrs[i] = fmt.Sprintf("%v", c)
		}
		sb.WriteString("TABLE " + table + " (" + strings.Join(colStrs, ", ") + ")\n")
	}

	if fks, ok := root["foreignKeys"].([]any); ok && len(fks) > 0 {
		sb.WriteString("FOREIGN KEYS\n")
		for _, fk := range fks {
			sb.WriteString(fmt.Sprintf("- %v\n", fk))
		}
	}

	if valueHints, ok := root["valueHints"].(map[string]any); ok && len(valueHints) > 0 {
		sb.WriteString("KNOWN COLUMN VALUES (SQL 식별자가 아닌 실제 데이터 값)\n")
		hintKeys := make([]string, 0, len(valueHints))
		for k := range valueHints {
			hintKeys = append(hintKeys, k)
		}
		sort.Strings(hintKeys)
		for _, column := range hintKeys {
			values, _ := valueHints[column].([]any)
			escaped := make([]string, len(values))
			for i, v := range values {
				escaped[i] = "'" + strings.ReplaceAll(fmt.Sprintf("%v", v), "'", "''") + "'"
			}
			sb.WriteString("- " + column + " = [" + strings.Join(escaped, ", ") + "]\n")
		}
	}

	sb.WriteString("RULES\n")
	sb.WriteString("- TABLE에 선언된 테이블과 컬럼만 SQL 식별자로 사용한다.\n")
	sb.WriteString("- KNOWN COLUMN VALUES의 값은 해당 컬럼의 비교값으로만 사용한다.\n")
	sb.WriteString("- JOIN은 FOREIGN KEYS에 선언된 관계만 사용한다.")

	return sb.String()
}
