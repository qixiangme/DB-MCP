package answer

import "testing"

func TestStructuredEvidenceFormatter_PreservesExplicitCountUnit(t *testing.T) {
	f := &StructuredEvidenceFormatter{}
	if got := f.FormatSQL("고객사는 몇 개야?", "count=8"); got != "총 8개 입니다." {
		t.Fatalf("got %q", got)
	}
	if got := f.FormatSQL("직원은 몇 명이야?", "count=4"); got != "총 4명 입니다." {
		t.Fatalf("got %q", got)
	}
}

func TestStructuredEvidenceFormatter_NoExplicitUnitInfersFromDomainNoun(t *testing.T) {
	f := &StructuredEvidenceFormatter{}
	if got := f.FormatSQL("해결되지 않은 건은?", "count=5"); got != "총 5건 입니다." {
		t.Fatalf("got %q", got)
	}
	if got := f.FormatSQL("등록 고객사 수는?", "count=3"); got != "총 3곳 입니다." {
		t.Fatalf("got %q", got)
	}
}

func TestStructuredEvidenceFormatter_NonSingleCountResultUnchanged(t *testing.T) {
	f := &StructuredEvidenceFormatter{}
	rows := "name=Client-A, count=3\nname=Client-B, count=2"
	if got := f.FormatSQL("고객사별 계약 수는?", rows); got != rows {
		t.Fatalf("got %q", got)
	}
}
