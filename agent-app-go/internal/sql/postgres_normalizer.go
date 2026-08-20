package sql

import "strings"

// PostgresSqlNormalizer ports PostgresSqlNormalizer.kt 1:1.
type PostgresSqlNormalizer struct{}

func (n *PostgresSqlNormalizer) Normalize(sql string) string {
	return strings.ReplaceAll(sql, "`", `"`)
}
