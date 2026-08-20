package tools

import (
	"strings"
	"testing"
)

// Test names mirror SqlGuardTest.kt cases 1:1 for functional-equivalence review.

func TestSanitizeSQL_SimpleSelectGetsLimitAppended(t *testing.T) {
	sql, err := SanitizeSQL("SELECT name, salary FROM employees WHERE dept = '플랫폼팀'")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasSuffix(sql, "LIMIT 50") {
		t.Fatalf("expected LIMIT 50 suffix, got %q", sql)
	}
}

func TestSanitizeSQL_ExistingLimitPassesThrough(t *testing.T) {
	sql, err := SanitizeSQL("select * from products order by price desc limit 5;")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "select * from products order by price desc limit 5"
	if sql != want {
		t.Fatalf("got %q, want %q", sql, want)
	}
}

func TestSanitizeSQL_WithClauseAllowed(t *testing.T) {
	sql, err := SanitizeSQL("WITH t AS (SELECT dept FROM employees) SELECT dept FROM t")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(sql, "WITH") {
		t.Fatalf("expected WITH prefix, got %q", sql)
	}
}

func TestSanitizeSQL_DmlAndDdlRejected(t *testing.T) {
	for _, sql := range []string{
		"DELETE FROM employees",
		"DROP TABLE products",
		"UPDATE products SET price = 0",
	} {
		if _, err := SanitizeSQL(sql); err == nil {
			t.Fatalf("expected rejection for %q", sql)
		}
	}
}

func TestSanitizeSQL_MultiStatementAndCommentInjectionRejected(t *testing.T) {
	if _, err := SanitizeSQL("SELECT 1; DROP TABLE employees"); err == nil {
		t.Fatal("expected rejection for multi-statement SQL")
	}
	if _, err := SanitizeSQL("SELECT * FROM employees -- hidden"); err == nil {
		t.Fatal("expected rejection for comment injection")
	}
}

func TestSanitizeSQL_DangerousFunctionDisguisedAsSelectRejected(t *testing.T) {
	if _, err := SanitizeSQL("SELECT pg_sleep(10)"); err == nil {
		t.Fatal("expected rejection for pg_sleep")
	}
}

func TestSanitizeSQL_MixedCaseBypassRejected(t *testing.T) {
	if _, err := SanitizeSQL("sElEcT DeLeTe FROM users"); err == nil {
		t.Fatal("expected rejection for mixed-case DELETE bypass")
	}
	if _, err := SanitizeSQL("SELECT InSeRt FROM users"); err == nil {
		t.Fatal("expected rejection for mixed-case INSERT bypass")
	}
}

func TestSanitizeSQL_DangerousFunctionBypassRejected(t *testing.T) {
	if _, err := SanitizeSQL("SELECT PG_SLEEP(5)"); err == nil {
		t.Fatal("expected rejection for PG_SLEEP")
	}
	if _, err := SanitizeSQL("SELECT pg_read_file('/etc/passwd')"); err == nil {
		t.Fatal("expected rejection for pg_read_file")
	}
	if _, err := SanitizeSQL("SELECT lo_import('/etc/passwd')"); err == nil {
		t.Fatal("expected rejection for lo_import")
	}
}

func TestSanitizeSQL_DangerousFunctionInSubqueryRejected(t *testing.T) {
	if _, err := SanitizeSQL("SELECT * FROM (SELECT pg_sleep(1)) t"); err == nil {
		t.Fatal("expected rejection for pg_sleep in subquery")
	}
}

func TestSanitizeSQL_IntoKeywordRejected(t *testing.T) {
	if _, err := SanitizeSQL("SELECT * INTO new_table FROM employees"); err == nil {
		t.Fatal("expected rejection for INTO keyword")
	}
}
