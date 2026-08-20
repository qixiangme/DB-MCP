package tools

import "testing"

// These cases exercise planKgSearch's pure token/predicate/WHERE-building logic,
// which has no dedicated Kotlin unit test in the baseline (kg_search is only covered
// end-to-end). Cases are derived directly from RetrievalTools.kgSearch's documented
// examples (graph/schema.md) and inline comments in RetrievalTools.kt.

func TestPlanKgSearch_NoTokensNoPredicatesIsEmpty(t *testing.T) {
	plan := planKgSearch("누구 무엇 알려줘")
	if !plan.Empty {
		t.Fatalf("expected empty plan, got %+v", plan)
	}
}

func TestPlanKgSearch_SpecificEntityAndPredicateAndCombine(t *testing.T) {
	plan := planKgSearch("Client-A가 사용하는 제품")
	if len(plan.EntityTokens) == 0 {
		t.Fatalf("expected entity token for 'Client-A', got %+v", plan)
	}
	if len(plan.MatchedPredicates) == 0 || plan.MatchedPredicates[0] != "사용한다" {
		t.Fatalf("expected matched predicate 사용한다, got %v", plan.MatchedPredicates)
	}
	if plan.Where[0] != '(' {
		t.Fatalf("expected AND-combined WHERE (entity AND predicate), got %q", plan.Where)
	}
}

func TestPlanKgSearch_GenericTokenWithPredicateOrCombines(t *testing.T) {
	plan := planKgSearch("진행 중인 프로젝트")
	if len(plan.EntityTokens) != 0 {
		t.Fatalf("expected no entity tokens, got %v", plan.EntityTokens)
	}
	if len(plan.MatchedPredicates) == 0 {
		t.Fatalf("expected matched predicate for 진행, got %v", plan.MatchedPredicates)
	}
	if plan.Where[0] == '(' {
		t.Fatalf("expected OR-combined WHERE (no specific entity), got %q", plan.Where)
	}
}

func TestPlanKgSearch_ParticleStripping(t *testing.T) {
	plan := planKgSearch("Product-C1을 사용하는 고객사는")
	found := false
	for _, tok := range plan.EntityTokens {
		if tok == "Product-C1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected particle-stripped 'Product-C1' entity token, got %v", plan.EntityTokens)
	}
}

func TestPlanKgSearch_ExpansionTriggerDetection(t *testing.T) {
	if !requiresExpansion("Product-D1과 2홉으로 연결된 프로젝트") {
		t.Fatal("expected expansion trigger to fire on '연결된 프로젝트'")
	}
	if requiresExpansion("Product-D1 사용 고객") {
		t.Fatal("expected no expansion trigger for a plain direct-lookup question")
	}
}

func TestPlanKgSearch_TokensCappedAtFour(t *testing.T) {
	plan := planKgSearch("팀A 팀B 팀C 팀D 팀E 팀F")
	if len(plan.Tokens) > 4 {
		t.Fatalf("expected at most 4 tokens, got %d: %v", len(plan.Tokens), plan.Tokens)
	}
}
