// Package tools ports com.riwonace.mcp.tools from the Kotlin/Spring AI baseline.
package tools

import (
	"fmt"
	"regexp"
	"strings"
)

// forbiddenKeywords mirrors SqlGuard.kt's FORBIDDEN_KEYWORDS exactly.
var forbiddenKeywords = map[string]bool{
	"insert": true, "update": true, "delete": true, "drop": true, "truncate": true,
	"alter": true, "create": true, "grant": true, "revoke": true, "copy": true,
	"vacuum": true, "do": true, "call": true, "execute": true, "merge": true,
	"set": true, "pg_sleep": true, "into": true,
}

// dangerousFunctions mirrors SqlGuard.kt's DANGEROUS_FUNCTIONS exactly.
var dangerousFunctions = []string{
	"pg_sleep", "pg_stat_file", "pg_read_file", "pg_ls_dir",
	"lo_import", "lo_export", "dblink", "dblink_exec",
	"pg_terminate_backend", "pg_cancel_backend",
}

var allowedStarters = map[string]bool{"select": true, "with": true}

const defaultLimit = 50

// sqlTokenizer mirrors SqlGuard.kt's tokenize() splitter: [\s(),=<>!+\-*/|&^~]+
var sqlTokenizer = regexp.MustCompile(`[\s(),=<>!+\-*/|&^~]+`)

// SqlGuardError is a validation failure equivalent to Kotlin's IllegalArgumentException from SqlGuard.
type SqlGuardError struct{ Message string }

func (e *SqlGuardError) Error() string { return e.Message }

// SanitizeSQL ports SqlGuard.sanitize(rawSql) 1:1, including the auto-appended LIMIT.
func SanitizeSQL(rawSql string) (string, error) {
	sql := strings.TrimSpace(rawSql)
	sql = strings.TrimSuffix(sql, ";")
	sql = strings.TrimSpace(sql)

	if sql == "" {
		return "", &SqlGuardError{"SQL이 비어 있습니다."}
	}
	if strings.Contains(sql, ";") {
		return "", &SqlGuardError{"복수 문장 SQL은 허용되지 않습니다."}
	}
	if strings.Contains(sql, "--") {
		return "", &SqlGuardError{"주석(--) 포함 SQL은 허용되지 않습니다."}
	}
	if strings.Contains(sql, "/*") {
		return "", &SqlGuardError{"주석(/*) 포함 SQL은 허용되지 않습니다."}
	}

	tokens := tokenizeSQL(sql)
	if len(tokens) == 0 {
		return "", &SqlGuardError{"SQL 토큰이 비어 있습니다."}
	}

	firstToken := strings.ToLower(tokens[0])
	if !allowedStarters[firstToken] {
		return "", &SqlGuardError{"SELECT 또는 WITH ... SELECT 문만 실행할 수 있습니다."}
	}

	for _, token := range tokens {
		lower := strings.ToLower(token)
		if forbiddenKeywords[lower] {
			return "", &SqlGuardError{fmt.Sprintf("읽기 전용 정책상 '%s' 키워드는 허용되지 않습니다.", token)}
		}
	}

	sqlUpper := strings.ToUpper(sql)
	for _, fn := range dangerousFunctions {
		if strings.Contains(sqlUpper, strings.ToUpper(fn)+"(") {
			return "", &SqlGuardError{fmt.Sprintf("'%s' 함수는 실행할 수 없습니다.", fn)}
		}
	}

	hasLimit := false
	for _, t := range tokens {
		if strings.ToLower(t) == "limit" {
			hasLimit = true
			break
		}
	}
	if !hasLimit {
		sql = fmt.Sprintf("%s LIMIT %d", sql, defaultLimit)
	}

	return sql, nil
}

func tokenizeSQL(sql string) []string {
	parts := sqlTokenizer.Split(sql, -1)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
