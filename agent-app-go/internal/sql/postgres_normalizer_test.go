package sql

import "testing"

func TestPostgresSqlNormalizer_ConvertsMysqlBackticksToPostgresDoubleQuotes(t *testing.T) {
	n := &PostgresSqlNormalizer{}
	got := n.Normalize("SELECT `price_monthly` FROM products WHERE name = 'Product-C1'")
	want := `SELECT "price_monthly" FROM products WHERE name = 'Product-C1'`
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestPostgresSqlNormalizer_PreservesStringLiteralsAndPlainPostgres(t *testing.T) {
	n := &PostgresSqlNormalizer{}
	sql := "SELECT name FROM products WHERE name = 'Product-C1'"
	if got := n.Normalize(sql); got != sql {
		t.Fatalf("got %q", got)
	}
}
