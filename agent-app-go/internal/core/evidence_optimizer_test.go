package core

import (
	"strings"
	"testing"

	agentcontext "github.com/riwonace/agent-app-go/internal/context"
	"github.com/riwonace/agent-app-go/internal/router"
)

func newOptimizerProfile(intent QueryIntent) QueryProfile {
	return QueryProfile{
		Intent:           intent,
		Complexity:       0.3,
		Uncertainty:      0.2,
		RequiredEvidence: map[EvidenceType]bool{EvidenceStructuredData: true},
		SuggestedRoutes:  []router.Route{router.RouteSQL},
	}
}

func TestEvidenceOptimizer_BelowMinRelevanceExcluded(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	items := []agentcontext.ContextItem{
		{Source: "a", Text: "높은 관련도", Score: 0.8},
		{Source: "b", Text: "낮은 관련도", Score: 0.1},
	}
	result := opt.Optimize(items, []router.Route{router.RouteVector}, newOptimizerProfile(IntentFactual))
	if len(result.Selected) != 1 || result.Selected[0].Source != "a" {
		t.Fatalf("got %+v", result.Selected)
	}
	if result.ExcludedCount != 1 {
		t.Fatalf("got %d", result.ExcludedCount)
	}
}

func TestEvidenceOptimizer_HighValueItemSelectedFirstWithinBudget(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	items := []agentcontext.ContextItem{
		{Source: "low", Text: strings.Repeat("x", 200), Score: 0.5},
		{Source: "high", Text: strings.Repeat("y", 200), Score: 0.9},
	}
	result := opt.Optimize(items, []router.Route{router.RouteVector}, newOptimizerProfile(IntentFactual))
	if result.Selected[0].Source != "high" {
		t.Fatalf("got %+v", result.Selected)
	}
}

func TestEvidenceOptimizer_DuplicateItemsRemoved(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	dup := "중복된 문서 내용입니다."
	items := []agentcontext.ContextItem{
		{Source: "a", Text: dup, Score: 0.9},
		{Source: "b", Text: dup, Score: 0.8},
	}
	result := opt.Optimize(items, []router.Route{router.RouteVector}, newOptimizerProfile(IntentFactual))
	if len(result.Selected) != 1 {
		t.Fatalf("got %+v", result.Selected)
	}
	if result.DeduplicatedCount != 1 {
		t.Fatalf("got %d", result.DeduplicatedCount)
	}
}

func TestEvidenceOptimizer_SqlSourceWeightedOnSqlRoute(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	items := []agentcontext.ContextItem{
		{Source: "document", Text: "문서 내용", Score: 0.9},
		{Source: "sql", Text: "SQL 결과 123", Score: 0.7},
	}
	result := opt.Optimize(items, []router.Route{router.RouteSQL}, newOptimizerProfile(IntentFactual))
	if result.Selected[0].Source != "sql" {
		t.Fatalf("got %+v", result.Selected)
	}
}

func TestEvidenceOptimizer_OversizedFirstItemTruncatedButIncluded(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	items := []agentcontext.ContextItem{
		{Source: "oversize", Text: strings.Repeat("x", 1000), Score: 0.9},
	}
	result := opt.Optimize(items, []router.Route{router.RouteVector}, newOptimizerProfile(IntentFactual))
	if len(result.Selected) != 1 {
		t.Fatalf("got %+v", result.Selected)
	}
	if len([]rune(result.Selected[0].Text)) > 500 {
		t.Fatalf("text too long: %d", len([]rune(result.Selected[0].Text)))
	}
	if !strings.HasSuffix(result.Selected[0].Text, "…(truncated)") {
		t.Fatalf("got %q", result.Selected[0].Text)
	}
}

func TestEvidenceOptimizer_SqlOnlyRouteUsesHalfBudget(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	items := []agentcontext.ContextItem{
		{Source: "sql1", Text: strings.Repeat("s", 200), Score: 0.9},
		{Source: "sql2", Text: strings.Repeat("s", 200), Score: 0.8},
		{Source: "sql3", Text: strings.Repeat("s", 200), Score: 0.7},
	}
	result := opt.Optimize(items, []router.Route{router.RouteSQL}, newOptimizerProfile(IntentFactual))
	if result.UsedBudget > 250 {
		t.Fatalf("got %d", result.UsedBudget)
	}
}

func TestEvidenceOptimizer_LostInMiddleMitigationAppliedAtThreeOrMore(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	items := []agentcontext.ContextItem{
		{Source: "1st", Text: strings.Repeat("a", 50), Score: 0.9},
		{Source: "2nd", Text: strings.Repeat("b", 50), Score: 0.8},
		{Source: "3rd", Text: strings.Repeat("c", 50), Score: 0.7},
	}
	result := opt.Optimize(items, []router.Route{router.RouteVector}, newOptimizerProfile(IntentFactual))
	if result.Selected[0].Source != "1st" {
		t.Fatalf("got %+v", result.Selected)
	}
	if result.Selected[len(result.Selected)-1].Source != "2nd" {
		t.Fatalf("got %+v", result.Selected)
	}
}

func TestEvidenceOptimizer_EmptyListReturnsEmptyResult(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	result := opt.Optimize(nil, []router.Route{router.RouteVector}, newOptimizerProfile(IntentFactual))
	if len(result.Selected) != 0 {
		t.Fatalf("got %+v", result.Selected)
	}
	if result.TotalValue != 0.0 {
		t.Fatalf("got %v", result.TotalValue)
	}
}

func TestEvidenceOptimizer_NumericEvidenceSelectedForQuantityQuestion(t *testing.T) {
	opt := &EvidenceOptimizer{BudgetChars: 500}
	items := []agentcontext.ContextItem{
		{Source: "text", Text: "설명만 있는 문서입니다.", Score: 0.8},
		{Source: "data", Text: "총 매출은 1,234,567원입니다.", Score: 0.7},
	}
	result := opt.Optimize(items, []router.Route{router.RouteSQL}, newOptimizerProfile(IntentAggregation))
	if len(result.Selected) == 0 {
		t.Fatal("expected non-empty selection")
	}
	found := false
	for _, s := range result.Selected {
		if s.Source == "data" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected 'data' item in selection, got %+v", result.Selected)
	}
}
