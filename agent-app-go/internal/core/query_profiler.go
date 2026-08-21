package core

import (
	"regexp"
	"strings"

	"github.com/riwonace/agent-app-go/internal/router"
)

const (
	ComplexityThresholdMedium = 0.4
	ComplexityThresholdHigh   = 0.7
	UncertaintyThreshold      = 0.5
)

var (
	comparisonSuperlativeRe = regexp.MustCompile(`(더|가장|제일)\s*(높|낮|많|적|크|작)`)
	aggregationTotalRe      = regexp.MustCompile(`(전체|모든).*수`)
	multiHopUpperLowerRe    = regexp.MustCompile(`(상위|하위).*의.*`)
	conditionCountRe        = regexp.MustCompile(`인|한|의|에서|부터|까지|이상|이하|초과|미만|\d+`)
	vagueTimeRangeRe        = regexp.MustCompile(`\d{4}|올해|작년|이번|지난|최근`)
	dependencyResultSearch  = regexp.MustCompile(`(결과|데이터).*로.*검색`)
	dependencyRankInfo      = regexp.MustCompile(`(상위|하위).*의.*(정보|내용|설명)`)
	dependencyAboutThat     = regexp.MustCompile(`(해당|그).*에 대한`)
	sqlEvidenceRe           = regexp.MustCompile(`몇|수|개수|합계|평균|최대|최소|총`)
)

// QueryProfiler ports QueryProfiler.kt 1:1: heuristic intent/complexity/uncertainty
// classification. Route selection is delegated to RuleBasedRouter (the single source
// of truth), matching the Kotlin comment that the profiler must not re-derive routes.
type QueryProfiler struct {
	Router *router.RuleBasedRouter
}

func (p *QueryProfiler) Profile(question string) QueryProfile {
	intent := classifyIntent(question)
	complexity := estimateComplexity(question, intent)
	uncertainty := estimateUncertainty(question, intent)
	requiredEvidence := inferRequiredEvidence(intent, question)
	suggestedRoutes := p.Router.Route(question)
	isMultiHop := intent == IntentMultiHop || strings.Contains(question, "그리고") || strings.Contains(question, "후에")
	hasDependency := detectDependency(question)

	return QueryProfile{
		Intent:           intent,
		Complexity:       complexity,
		Uncertainty:      uncertainty,
		RequiredEvidence: requiredEvidence,
		SuggestedRoutes:  suggestedRoutes,
		IsMultiHop:       isMultiHop,
		HasDependency:    hasDependency,
	}
}

func classifyIntent(question string) QueryIntent {
	q := strings.ToLower(question)

	switch {
	case strings.Contains(q, "비교") || strings.Contains(q, "차이") || strings.Contains(q, "vs") ||
		strings.Contains(q, "보다") || comparisonSuperlativeRe.MatchString(q):
		return IntentComparison

	case strings.Contains(q, "평균") || strings.Contains(q, "합계") || strings.Contains(q, "총") ||
		strings.Contains(q, "몇 개") || strings.Contains(q, "몇개") || strings.Contains(q, "몇 명") ||
		strings.Contains(q, "개수") || strings.Contains(q, "수는") || aggregationTotalRe.MatchString(q):
		return IntentAggregation

	case strings.Contains(q, "그리고") || strings.Contains(q, "후에") || strings.Contains(q, "다음에") ||
		multiHopUpperLowerRe.MatchString(q) || countRune(q, '?')+countRune(q, '의') >= 3:
		return IntentMultiHop

	case strings.Contains(q, "누가") || strings.Contains(q, "담당") || strings.Contains(q, "소속") ||
		strings.Contains(q, "관련") || strings.Contains(q, "연결"):
		return IntentRelation

	case strings.Contains(q, "무엇") || strings.Contains(q, "뭐") || strings.Contains(q, "왜") ||
		strings.Contains(q, "어떻게") || strings.Contains(q, "설명") || strings.Contains(q, "정의") ||
		strings.Contains(q, "이란") || strings.Contains(q, "란"):
		return IntentExplanation

	default:
		return IntentFactual
	}
}

func countRune(s string, r rune) int {
	n := 0
	for _, c := range s {
		if c == r {
			n++
		}
	}
	return n
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func estimateComplexity(question string, intent QueryIntent) float64 {
	score := 0.0

	switch intent {
	case IntentMultiHop:
		score += 0.5
	case IntentComparison:
		score += 0.35
	case IntentRelation:
		score += 0.3
	case IntentAggregation:
		score += 0.25
	case IntentExplanation:
		score += 0.2
	case IntentFactual:
		score += 0.1
	}

	score += min(float64(len([]rune(question)))/200.0, 0.2)

	conditionCount := len(conditionCountRe.FindAllString(question, -1))
	score += min(float64(conditionCount)*0.05, 0.2)

	questionMarks := countRune(question, '?')
	if questionMarks > 1 {
		score += 0.1 * float64(questionMarks-1)
	}

	return clamp01(score)
}

var vagueTerms = []string{"아마", "것 같", "정도", "대략", "약", "거의", "좀", "어느정도", "대충"}

func estimateUncertainty(question string, intent QueryIntent) float64 {
	score := 0.0
	q := strings.ToLower(question)

	for _, term := range vagueTerms {
		if strings.Contains(q, term) {
			score += 0.15
		}
	}

	if intent == IntentExplanation {
		score += 0.2
	}

	if !vagueTimeRangeRe.MatchString(q) && (strings.Contains(q, "매출") || strings.Contains(q, "실적") || strings.Contains(q, "추이")) {
		score += 0.15
	}

	if strings.Contains(q, "그것") || strings.Contains(q, "이것") || strings.Contains(q, "저것") {
		score += 0.2
	}

	return clamp01(score)
}

func inferRequiredEvidence(intent QueryIntent, question string) map[EvidenceType]bool {
	evidence := make(map[EvidenceType]bool)
	q := strings.ToLower(question)

	if intent == IntentFactual || intent == IntentAggregation || intent == IntentComparison || sqlEvidenceRe.MatchString(q) {
		evidence[EvidenceStructuredData] = true
	}

	if intent == IntentExplanation || strings.Contains(q, "설명") || strings.Contains(q, "정의") ||
		strings.Contains(q, "방법") || strings.Contains(q, "절차") {
		evidence[EvidenceDocument] = true
	}

	if intent == IntentRelation || strings.Contains(q, "누가") || strings.Contains(q, "관계") || strings.Contains(q, "연결") {
		evidence[EvidenceGraphRelation] = true
	}

	if intent == IntentMultiHop {
		evidence[EvidenceStructuredData] = true
		evidence[EvidenceDocument] = true
	}

	if len(evidence) == 0 {
		evidence[EvidenceDocument] = true
	}

	return evidence
}

func detectDependency(question string) bool {
	return dependencyResultSearch.MatchString(question) ||
		dependencyRankInfo.MatchString(question) ||
		dependencyAboutThat.MatchString(question)
}
