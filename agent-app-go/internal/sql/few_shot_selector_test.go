package sql

import (
	"strings"
	"testing"
)

func TestFewShotSelector_QuarterSalesQuestionSelectsActualQuarterColumnExample(t *testing.T) {
	s := &FewShotSelector{}
	selected := s.SelectExamples("2027년 4분기 총 매출은?", 1)
	if len(selected) != 1 {
		t.Fatalf("got %+v", selected)
	}
	if selected[0].Pattern != "quarter-sales" {
		t.Fatalf("got %q", selected[0].Pattern)
	}
	if !strings.Contains(selected[0].SQL, "FROM sales") || !strings.Contains(selected[0].SQL, "quarter") {
		t.Fatalf("got %q", selected[0].SQL)
	}
}

func TestFewShotSelector_ProductContractQuestionSelectsActualForeignKeyJoinExample(t *testing.T) {
	s := &FewShotSelector{}
	selected := s.SelectExamples("제품별 계약 금액 합계를 보여줘", 1)
	if selected[0].Pattern != "product-contract-sum" {
		t.Fatalf("got %q", selected[0].Pattern)
	}
	if !strings.Contains(selected[0].SQL, "c.product_id = p.id") {
		t.Fatalf("got %q", selected[0].SQL)
	}
}

func TestFewShotSelector_TicketExampleUsesActualTableName(t *testing.T) {
	s := &FewShotSelector{}
	selected := s.SelectExamples("해결되지 않은 티켓 수는?", 1)
	if selected[0].Pattern != "unresolved-ticket-count" {
		t.Fatalf("got %q", selected[0].Pattern)
	}
	if !strings.Contains(selected[0].SQL, "support_tickets") {
		t.Fatalf("got %q", selected[0].SQL)
	}
}
