package core

import (
	"math"
	"testing"

	agentcontext "github.com/riwonace/agent-app-go/internal/context"
	"github.com/riwonace/agent-app-go/internal/router"
)

func newGate() *AnswerabilityGate {
	return &AnswerabilityGate{CoverageThreshold: 0.7, UseLLM: false}
}

func newGateProfile(intent QueryIntent) QueryProfile {
	return QueryProfile{
		Intent:           intent,
		Complexity:       0.3,
		Uncertainty:      0.2,
		RequiredEvidence: map[EvidenceType]bool{EvidenceStructuredData: true},
		SuggestedRoutes:  []router.Route{router.RouteSQL},
		IsMultiHop:       intent == IntentMultiHop,
	}
}

func TestAnswerabilityGate_SufficientEvidenceProceedsOrPartial(t *testing.T) {
	gate := newGate()
	evidence := []agentcontext.ContextItem{{Source: "sql", Text: "count=42", Score: 0.9}}
	result := gate.Verify("직원 수는 몇 명인가요?", evidence, newGateProfile(IntentFactual))
	if !(result.Passed || result.RecommendedAction == ActionPartialAnswer) {
		t.Fatalf("got %+v", result)
	}
}

func TestAnswerabilityGate_InsufficientEvidenceRecommendsSearchOrDecline(t *testing.T) {
	gate := newGate()
	evidence := []agentcontext.ContextItem{{Source: "doc", Text: "일반적인 프로젝트 정보", Score: 0.5}}
	result := gate.Verify("김철수 팀장이 담당한 프로젝트와 그 매출은?", evidence, newGateProfile(IntentMultiHop))
	if result.RecommendedAction != ActionSearchMore && result.RecommendedAction != ActionDecline && result.RecommendedAction != ActionPartialAnswer {
		t.Fatalf("got %v", result.RecommendedAction)
	}
}

func TestAnswerabilityGate_VeryLowCoverageDeclines(t *testing.T) {
	gate := newGate()
	result := gate.Verify("언제 어디서 누가 왜 어떻게 했나요?", nil, newGateProfile(IntentMultiHop))
	if result.Passed {
		t.Fatal("expected not passed")
	}
	if result.RecommendedAction != ActionDecline {
		t.Fatalf("got %v", result.RecommendedAction)
	}
}

func TestAnswerabilityGate_PartialCoverageAllowsPartialAnswer(t *testing.T) {
	gate := newGate()
	evidence := []agentcontext.ContextItem{
		{Source: "doc", Text: "MCP는 Model Context Protocol의 약자로 AI 모델과 데이터 소스를 연결하는 표준입니다.", Score: 0.9},
	}
	result := gate.Verify("MCP의 정의와 활용 방법은?", evidence, newGateProfile(IntentExplanation))
	if !(result.Passed || result.RecommendedAction == ActionPartialAnswer) {
		t.Fatalf("got %+v", result)
	}
}

func TestAnswerabilityGate_NumericQuestionWithNumericEvidenceComputesCoverage(t *testing.T) {
	gate := newGate()
	evidence := []agentcontext.ContextItem{{Source: "sql", Text: "total_revenue=1234567", Score: 0.9}}
	result := gate.Verify("총 매출은 얼마인가요?", evidence, newGateProfile(IntentAggregation))
	if !contains(result.SupportedClaims, "quantity_value") {
		t.Fatalf("got %v", result.SupportedClaims)
	}
	if result.ClaimCoverage <= 0.0 {
		t.Fatalf("got %v", result.ClaimCoverage)
	}
}

func TestAnswerabilityGate_PersonInfoCoveredForPersonQuestion(t *testing.T) {
	gate := newGate()
	evidence := []agentcontext.ContextItem{{Source: "doc", Text: "프로젝트 담당자는 김철수 팀장입니다.", Score: 0.9}}
	result := gate.Verify("이 프로젝트를 누가 담당했나요?", evidence, newGateProfile(IntentRelation))
	if !contains(result.SupportedClaims, "person_identity") {
		t.Fatalf("got %v", result.SupportedClaims)
	}
}

func TestAnswerabilityGate_ClaimCoverageComputedExactly(t *testing.T) {
	gate := newGate()
	evidence := []agentcontext.ContextItem{{Source: "sql", Text: "count=42", Score: 0.9}}
	result := gate.Verify("직원 수는?", evidence, newGateProfile(IntentFactual))
	required := len(result.RequiredClaims)
	if required < 1 {
		required = 1
	}
	expected := float64(len(result.SupportedClaims)) / float64(required)
	if math.Abs(expected-result.ClaimCoverage) > 0.01 {
		t.Fatalf("got %v, want %v", result.ClaimCoverage, expected)
	}
}

func TestAnswerabilityGate_EmptyEvidenceLowCoverage(t *testing.T) {
	gate := newGate()
	result := gate.Verify("직원 수는?", nil, newGateProfile(IntentFactual))
	if result.ClaimCoverage >= 0.5 {
		t.Fatalf("got %v", result.ClaimCoverage)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
