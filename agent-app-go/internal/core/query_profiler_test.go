package core

import (
	"strings"
	"testing"

	"github.com/riwonace/agent-app-go/internal/router"
)

func newProfiler() *QueryProfiler {
	return &QueryProfiler{Router: &router.RuleBasedRouter{}}
}

func TestQueryProfiler_SimpleFactualQuestionClassifiedFactualOrAggregation(t *testing.T) {
	p := newProfiler().Profile("직원 수는?")
	if p.Intent != IntentFactual && p.Intent != IntentAggregation {
		t.Fatalf("got %v", p.Intent)
	}
	if p.Complexity >= 0.5 {
		t.Fatalf("got %v", p.Complexity)
	}
	if !p.RequiredEvidence[EvidenceStructuredData] {
		t.Fatal("expected STRUCTURED_DATA evidence")
	}
}

func TestQueryProfiler_AggregationQuestionClassifiedAggregation(t *testing.T) {
	p := newProfiler().Profile("평균 급여는 얼마인가요?")
	if p.Intent != IntentAggregation {
		t.Fatalf("got %v", p.Intent)
	}
	if !p.RequiredEvidence[EvidenceStructuredData] {
		t.Fatal("expected STRUCTURED_DATA evidence")
	}
	if !containsRoute(p.SuggestedRoutes, router.RouteSQL) {
		t.Fatalf("got %v", p.SuggestedRoutes)
	}
}

func TestQueryProfiler_ComparisonQuestionClassifiedComparison(t *testing.T) {
	p := newProfiler().Profile("A팀과 B팀의 매출 차이는?")
	if p.Intent != IntentComparison {
		t.Fatalf("got %v", p.Intent)
	}
	if p.Complexity < 0.35 {
		t.Fatalf("got %v", p.Complexity)
	}
}

func TestQueryProfiler_ExplanationQuestionNeedsDocument(t *testing.T) {
	p := newProfiler().Profile("MCP란 무엇인가?")
	if p.Intent != IntentExplanation {
		t.Fatalf("got %v", p.Intent)
	}
	if !p.RequiredEvidence[EvidenceDocument] {
		t.Fatal("expected DOCUMENT evidence")
	}
	if !containsRoute(p.SuggestedRoutes, router.RouteVector) {
		t.Fatalf("got %v", p.SuggestedRoutes)
	}
}

func TestQueryProfiler_MultiHopQuestionHighComplexity(t *testing.T) {
	p := newProfiler().Profile("매출 상위 제품의 장애 이력은?")
	if p.Intent != IntentMultiHop {
		t.Fatalf("got %v", p.Intent)
	}
	if p.Complexity < 0.5 {
		t.Fatalf("got %v", p.Complexity)
	}
	if !p.IsMultiHop {
		t.Fatal("expected IsMultiHop")
	}
}

func TestQueryProfiler_RelationQuestionNeedsGraph(t *testing.T) {
	p := newProfiler().Profile("이 프로젝트를 누가 개발했어?")
	if p.Intent != IntentRelation {
		t.Fatalf("got %v", p.Intent)
	}
	if !p.RequiredEvidence[EvidenceGraphRelation] {
		t.Fatal("expected GRAPH_RELATION evidence")
	}
	if !containsRoute(p.SuggestedRoutes, router.RouteGraph) {
		t.Fatalf("got %v", p.SuggestedRoutes)
	}
}

func TestQueryProfiler_PreservesDeterministicRouterRoutes(t *testing.T) {
	p := newProfiler()
	vector := p.Profile("백업 정책은 어떻게 되어 있어?")
	graph := p.Profile("플랫폼팀 팀장은 누구야?")

	if !containsRoute(vector.SuggestedRoutes, router.RouteVector) {
		t.Fatalf("got %v", vector.SuggestedRoutes)
	}
	if !containsRoute(graph.SuggestedRoutes, router.RouteGraph) {
		t.Fatalf("got %v", graph.SuggestedRoutes)
	}
	if containsRoute(vector.SuggestedRoutes, router.RouteSQL) {
		t.Fatalf("got %v", vector.SuggestedRoutes)
	}
}

func TestQueryProfiler_VagueExpressionsHighUncertainty(t *testing.T) {
	p := newProfiler().Profile("아마 작년쯤 매출 정도가 어느정도였나요?")
	if p.Uncertainty < 0.3 {
		t.Fatalf("got %v", p.Uncertainty)
	}
}

func TestQueryProfiler_LongQuestionHigherComplexity(t *testing.T) {
	profiler := newProfiler()
	short := profiler.Profile("직원 수는?")
	long := profiler.Profile(strings.Join([]string{
		"2023년 1분기에 A 부서에서 진행한 프로젝트 중 ",
		"예산이 1억 이상이고 기간이 3개월 이상인 프로젝트의 ",
		"담당자와 최종 결과를 알려주세요.",
	}, ""))
	if !(long.Complexity > short.Complexity) {
		t.Fatalf("expected long(%v) > short(%v)", long.Complexity, short.Complexity)
	}
}

func TestQueryProfiler_DependencyPatternDetected(t *testing.T) {
	p := newProfiler().Profile("상위 5개 제품의 상세 정보를 알려줘")
	if !p.HasDependency {
		t.Fatal("expected HasDependency")
	}
}

func containsRoute(routes []router.Route, r router.Route) bool {
	for _, x := range routes {
		if x == r {
			return true
		}
	}
	return false
}
