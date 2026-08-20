package sql

import (
	"strings"
	"testing"
)

// Test names mirror DeterministicSqlPlannerTest.kt cases 1:1.

func mustPlan(t *testing.T, p *DeterministicSqlPlanner, question string) string {
	t.Helper()
	got := p.Plan(question)
	if got == nil {
		t.Fatalf("expected non-nil plan for %q", question)
	}
	return *got
}

func TestPlan_SimpleProductAttributeAndActiveContractAggregation(t *testing.T) {
	p := &DeterministicSqlPlanner{}
	if got := mustPlan(t, p, "Product-C1의 월 가격 알려줘"); got != "SELECT price_monthly FROM products WHERE name = 'Product-C1'" {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "Product-S1 활성 계약 수 알려줘"); !strings.Contains(got, "count(*)") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "Product-D1 활성 계약 금액 합계 알려줘"); !strings.Contains(got, "sum(c.amount)") {
		t.Fatalf("got %q", got)
	}
}

func TestPlan_DepartmentAverageAndClientSalesUseCorrectForeignKeyJoins(t *testing.T) {
	p := &DeterministicSqlPlanner{}
	if got := mustPlan(t, p, "기술지원팀 평균 급여"); !strings.Contains(got, "e.dept_id = d.id") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "Client-Q 총 매출"); !strings.Contains(got, "s.client_id = c.id") {
		t.Fatalf("got %q", got)
	}
}

func TestPlan_AmbiguousCompoundNumericProductConditions(t *testing.T) {
	p := &DeterministicSqlPlanner{}
	if got := mustPlan(t, p, "월 120인 cloud 제품 중 CPU 기준을 만족하는 것은?"); !strings.Contains(got, "price_monthly = 120") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "활성 계약 금액이 22,000인 data 제품"); !strings.Contains(got, "HAVING sum(c.amount) = 22000") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "활성 계약이 6건인 security 제품"); !strings.Contains(got, "HAVING count(*) = 6") {
		t.Fatalf("got %q", got)
	}
}

func TestPlan_OutsideHighConfidencePatternReturnsNilForLLMFallback(t *testing.T) {
	p := &DeterministicSqlPlanner{}
	if got := p.Plan("최근 복잡한 프로젝트 상태를 분석해줘"); got != nil {
		t.Fatalf("expected nil, got %q", *got)
	}
}

func TestPlan_GeneralAggregationQuestionsCompileToSchemaBasedSelect(t *testing.T) {
	p := &DeterministicSqlPlanner{}
	if got := mustPlan(t, p, "서울 지역 매출 상위 5개 고객사를 알려줘"); !strings.Contains(got, "ORDER BY total_sales DESC") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "2025년 3분기 총 매출액은 얼마야?"); !strings.Contains(got, "quarter = '2025-Q3'") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "보안 솔루션 카테고리 제품들의 월 평균 매출은?"); !strings.Contains(got, "p.category = 'security'") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "현재 활성 상태인 계약 수는 몇 개야?"); !strings.Contains(got, "status = 'active'") {
		t.Fatalf("got %q", got)
	}
	if got := mustPlan(t, p, "평균 연봉이 가장 높은 부서는 어디야?"); !strings.Contains(got, "ORDER BY average_salary DESC") {
		t.Fatalf("got %q", got)
	}
}

func TestPlan_UnresolvedCriticalTicketsAggregatesActualStoredValues(t *testing.T) {
	p := &DeterministicSqlPlanner{}
	sql := mustPlan(t, p, "아직 해결되지 않은 Critical 티켓은 몇 건이야?")
	if !strings.Contains(sql, "priority = 'critical'") {
		t.Fatalf("got %q", sql)
	}
	if !strings.Contains(sql, "status IN ('open', 'in_progress')") {
		t.Fatalf("got %q", sql)
	}
}

func TestPlan_RegisteredClientsWithYearBuildsYearBoundary(t *testing.T) {
	p := &DeterministicSqlPlanner{}
	sql := mustPlan(t, p, "2024년에 등록된 고객사는 몇 곳이야?")
	if !strings.Contains(sql, "registered_at >= '2024-01-01'") {
		t.Fatalf("got %q", sql)
	}
	if !strings.Contains(sql, "registered_at < '2025-01-01'") {
		t.Fatalf("got %q", sql)
	}
}
