package sql

import "testing"

func TestSchemaLinker_LinksQuestionValuesFromDbSchemaValueHintsContract(t *testing.T) {
	linker := &SchemaLinker{}
	schema := `{
		"tables": {"departments": ["name (character varying)"]},
		"valueHints": {"departments.name": ["플랫폼팀", "기술지원팀"]}
	}`

	hints := linker.LinkEntities(schema, "기술지원팀 직원 목록")

	if len(hints) != 1 {
		t.Fatalf("got %+v", hints)
	}
	if hints[0].Suggestion != "departments.name = '기술지원팀'" {
		t.Fatalf("got %q", hints[0].Suggestion)
	}
}
