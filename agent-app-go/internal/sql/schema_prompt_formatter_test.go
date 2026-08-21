package sql

import (
	"strings"
	"testing"
)

func TestSchemaPromptFormatter_SeparatesTableForeignKeyValueHintSemanticAreas(t *testing.T) {
	f := &SchemaPromptFormatter{}
	raw := `{
		"tables": {
			"clients": ["id (integer)", "region (character varying)"],
			"sales": ["client_id (integer)", "amount (integer)"]
		},
		"foreignKeys": ["sales.client_id -> clients.id"],
		"valueHints": {"clients.region": ["서울", "경기"]}
	}`

	result := f.Format(raw)

	if !strings.Contains(result, "TABLE clients (id (integer), region (character varying))") {
		t.Fatalf("got %q", result)
	}
	if !strings.Contains(result, "sales.client_id -> clients.id") {
		t.Fatalf("got %q", result)
	}
	if !strings.Contains(result, "clients.region = ['서울', '경기']") {
		t.Fatalf("got %q", result)
	}
	if !strings.Contains(result, "SQL 식별자가 아닌 실제 데이터 값") {
		t.Fatalf("got %q", result)
	}
	if strings.Contains(result, "TABLE valueHints") {
		t.Fatalf("got %q", result)
	}
}

func TestSchemaPromptFormatter_SingleQuoteValuesEscapedAsSqlLiterals(t *testing.T) {
	f := &SchemaPromptFormatter{}
	raw := `{"tables":{"clients":["name (varchar)"]},"valueHints":{"clients.name":["O'Reilly"]}}`
	result := f.Format(raw)
	if !strings.Contains(result, "'O''Reilly'") {
		t.Fatalf("got %q", result)
	}
}

func TestSchemaPromptFormatter_NonJsonResponseFromOtherMcpImplFallsBackToRaw(t *testing.T) {
	f := &SchemaPromptFormatter{}
	raw := "TABLE clients(id integer)"
	if got := f.Format(raw); got != raw {
		t.Fatalf("got %q", got)
	}
}
