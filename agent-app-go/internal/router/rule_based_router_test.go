package router

import (
	"reflect"
	"testing"
)

// Test names mirror RuleBasedRouterTest.kt cases 1:1.

func contains(routes []Route, r Route) bool {
	for _, x := range routes {
		if x == r {
			return true
		}
	}
	return false
}

func TestRuleBasedRouter_AggregationQuestionRoutesToSQL(t *testing.T) {
	router := &RuleBasedRouter{}
	if !contains(router.Route("플랫폼팀 직원의 평균 급여는 얼마야?"), RouteSQL) {
		t.Fatal("expected SQL route")
	}
	if !contains(router.Route("가장 비싼 제품이 뭐야?"), RouteSQL) {
		t.Fatal("expected SQL route")
	}
}

func TestRuleBasedRouter_ConceptQuestionRoutesToVector(t *testing.T) {
	router := &RuleBasedRouter{}
	got := router.Route("MCP가 뭔가요? 설명해줘")
	if !reflect.DeepEqual(got, []Route{RouteVector}) {
		t.Fatalf("got %v", got)
	}
}

func TestRuleBasedRouter_RelationQuestionRoutesToGraph(t *testing.T) {
	router := &RuleBasedRouter{}
	if !contains(router.Route("air는 누가 개발했어?"), RouteGraph) {
		t.Fatal("expected GRAPH route")
	}
	if !contains(router.Route("MCP와 RAG는 무슨 사이야?"), RouteGraph) {
		t.Fatal("expected GRAPH route")
	}
}

func TestRuleBasedRouter_CompoundQuestionParallelRoutes(t *testing.T) {
	router := &RuleBasedRouter{}
	routes := router.Route("pgvector 개념을 설명하고 관련된 제품 목록도 알려줘")
	if !contains(routes, RouteSQL) || !contains(routes, RouteVector) {
		t.Fatalf("got %v", routes)
	}
}

func TestRuleBasedRouter_PriceAndInstallSelectsSqlAndVector(t *testing.T) {
	router := &RuleBasedRouter{}
	got := router.Route("월 가격과 설치에 필요한 컨테이너 도구를 함께 알려줘")
	if !reflect.DeepEqual(got, []Route{RouteSQL, RouteVector}) {
		t.Fatalf("got %v", got)
	}
}

func TestRuleBasedRouter_PriceAndActualUsageClientSelectsSqlAndGraph(t *testing.T) {
	router := &RuleBasedRouter{}
	got := router.Route("월 가격과 실제 이용 고객을 함께 알려줘")
	if !reflect.DeepEqual(got, []Route{RouteSQL, RouteGraph}) {
		t.Fatalf("got %v", got)
	}
}

func TestRuleBasedRouter_ProductNameAloneDoesNotOverselectSQL(t *testing.T) {
	router := &RuleBasedRouter{}
	got := router.Route("Product-C1 설치 방식과 이 제품을 실제 사용하는 고객사를 알려줘")
	if !reflect.DeepEqual(got, []Route{RouteGraph, RouteVector}) {
		t.Fatalf("got %v", got)
	}
}

func TestRuleBasedRouter_NumericConditionProductWithDocsAndUsageSelectsThreeRoutes(t *testing.T) {
	router := &RuleBasedRouter{}
	got := router.Route("월 120인 cloud 제품 중 CPU 62%이며 Client-A가 사용하는 것은?")
	if !reflect.DeepEqual(got, []Route{RouteSQL, RouteGraph, RouteVector}) {
		t.Fatalf("got %v", got)
	}
}

func TestRuleBasedRouter_ReleaseStatusAndBackupSelectsSqlAndVector(t *testing.T) {
	router := &RuleBasedRouter{}
	got := router.Route("출시 상태와 백업 실행 시각 및 보관일을 알려줘")
	if !reflect.DeepEqual(got, []Route{RouteSQL, RouteVector}) {
		t.Fatalf("got %v", got)
	}
}

func TestRuleBasedRouter_NoRuleMatchDefaultsToVector(t *testing.T) {
	router := &RuleBasedRouter{}
	got := router.Route("안녕하세요")
	if !reflect.DeepEqual(got, []Route{RouteVector}) {
		t.Fatalf("got %v", got)
	}
}

type fallbackFunc func(question string) []Route

func (f fallbackFunc) Classify(question string) []Route { return f(question) }

func TestRuleBasedRouter_FallbackDelegatesOnNoKeywordMatch(t *testing.T) {
	router := &RuleBasedRouter{Fallback: fallbackFunc(func(string) []Route { return []Route{RouteGraph} })}
	got := router.Route("키워드가 하나도 안 걸리는 질문")
	if !reflect.DeepEqual(got, []Route{RouteGraph}) {
		t.Fatalf("got %v", got)
	}
}

func TestRuleBasedRouter_FallbackNotCalledWhenKeywordMatches(t *testing.T) {
	called := false
	router := &RuleBasedRouter{Fallback: fallbackFunc(func(string) []Route {
		called = true
		return []Route{RouteGraph}
	})}
	router.Route("가장 비싼 제품이 뭐야?")
	if called {
		t.Fatal("fallback should not have been called")
	}
}

func TestRuleBasedRouter_CompositionCueAugmentsSingleRuleWithFallbackMultiRoute(t *testing.T) {
	router := &RuleBasedRouter{Fallback: fallbackFunc(func(string) []Route { return []Route{RouteSQL, RouteGraph} })}
	got := router.Route("월 가격과 실제 이용 고객을 함께 알려줘")
	if !reflect.DeepEqual(got, []Route{RouteSQL, RouteGraph}) {
		t.Fatalf("got %v", got)
	}
}
