package core

import (
	"fmt"
	"regexp"
	"strings"

	agentcontext "github.com/riwonace/agent-app-go/internal/context"
)

type GateAction string

const (
	ActionProceed        GateAction = "PROCEED"
	ActionSearchMore      GateAction = "SEARCH_MORE"
	ActionDecline        GateAction = "DECLINE"
	ActionPartialAnswer  GateAction = "PARTIAL_ANSWER"
)

// GateResult mirrors data class GateResult.
type GateResult struct {
	Passed            bool
	ClaimCoverage     float64
	RequiredClaims    []string
	SupportedClaims   []string
	MissingClaims     []string
	RecommendedAction GateAction
	Reasoning         string
}

var (
	entityParticleRe = regexp.MustCompile(`[\x{AC00}-\x{D7A3}]{2,}(의|은|는|이|가|을|를)`)
	entitySingleQuote = regexp.MustCompile(`'[^']+'`)
	entityDoubleQuote = regexp.MustCompile(`"[^"]+"`)
	entityStripRe     = regexp.MustCompile(`[의은는이가을를'"]`)

	timeInfoRe     = regexp.MustCompile(`\d{4}|\d+월|\d+일|\d+년`)
	locationInfoRe = regexp.MustCompile(`[\x{AC00}-\x{D7A3}]+(시|도|구|동|로|길)`)
	quantityRe     = regexp.MustCompile(`\d+`)
	personInfoRe1  = regexp.MustCompile(`[\x{AC00}-\x{D7A3}]{2,4}\s*(씨|님|대표|사장|이사|팀장|과장|부장|매니저)`)
	personInfoRe2  = regexp.MustCompile(`담당자|개발자|관리자|작성자`)
)

// AnswerabilityGate ports AnswerabilityGate.kt 1:1: heuristic claim-coverage
// verification. The `useLlm` config flag exists in the baseline but is never actually
// read inside verify() there either -- preserved here as a documented no-op field to
// match that exact (if surprising) baseline behavior, not as a bug to fix.
type AnswerabilityGate struct {
	CoverageThreshold float64
	UseLLM            bool
}

func (g *AnswerabilityGate) Verify(question string, evidence []agentcontext.ContextItem, profile QueryProfile) GateResult {
	requiredClaims := extractRequiredClaims(question, profile)
	supportedClaims := extractSupportedClaims(evidence, requiredClaims)

	var coverage float64
	if len(requiredClaims) == 0 {
		coverage = 1.0
	} else {
		coverage = float64(len(supportedClaims)) / float64(len(requiredClaims))
	}

	supportedSet := make(map[string]bool, len(supportedClaims))
	for _, c := range supportedClaims {
		supportedSet[c] = true
	}
	var missingClaims []string
	for _, c := range requiredClaims {
		if !supportedSet[c] {
			missingClaims = append(missingClaims, c)
		}
	}

	action := determineGateAction(coverage, missingClaims, profile, g.CoverageThreshold)
	passed := action == ActionProceed || action == ActionPartialAnswer

	return GateResult{
		Passed:            passed,
		ClaimCoverage:     coverage,
		RequiredClaims:    requiredClaims,
		SupportedClaims:   supportedClaims,
		MissingClaims:     missingClaims,
		RecommendedAction: action,
		Reasoning:         buildGateReasoning(coverage, len(requiredClaims), len(supportedClaims), action),
	}
}

func extractRequiredClaims(question string, profile QueryProfile) []string {
	var claims []string
	seen := make(map[string]bool)
	add := func(c string) {
		if !seen[c] {
			seen[c] = true
			claims = append(claims, c)
		}
	}

	q := strings.ToLower(question)
	if strings.Contains(q, "누가") || strings.Contains(q, "누구") {
		add("person_identity")
	}
	if strings.Contains(q, "언제") {
		add("time_info")
	}
	if strings.Contains(q, "어디") || strings.Contains(q, "위치") {
		add("location_info")
	}
	if strings.Contains(q, "왜") || strings.Contains(q, "이유") {
		add("reason_explanation")
	}
	if strings.Contains(q, "어떻게") || strings.Contains(q, "방법") {
		add("method_process")
	}
	if strings.Contains(q, "얼마") || strings.Contains(q, "몇") {
		add("quantity_value")
	}

	switch profile.Intent {
	case IntentFactual:
		add("factual_data")
	case IntentAggregation:
		add("aggregated_value")
	case IntentComparison:
		add("comparison_item_a")
		add("comparison_item_b")
	case IntentExplanation:
		add("concept_definition")
	case IntentMultiHop:
		add("intermediate_result")
		add("final_result")
	case IntentRelation:
		add("relationship_info")
	}

	for _, pattern := range []*regexp.Regexp{entityParticleRe, entitySingleQuote, entityDoubleQuote} {
		for _, match := range pattern.FindAllString(question, -1) {
			entity := strings.TrimSpace(entityStripRe.ReplaceAllString(match, ""))
			if len([]rune(entity)) >= 2 {
				add("entity_" + entity)
			}
		}
	}

	return claims
}

func extractSupportedClaims(evidence []agentcontext.ContextItem, requiredClaims []string) []string {
	var texts []string
	hasSQLSource := false
	hasGraphSource := false
	for _, e := range evidence {
		texts = append(texts, e.Text)
		if e.Source == "sql" {
			hasSQLSource = true
		}
		if e.Source == "knowledge-graph" {
			hasGraphSource = true
		}
	}
	combinedText := strings.ToLower(strings.Join(texts, " "))

	var supported []string
	for _, claim := range requiredClaims {
		switch {
		case claim == "person_identity" && anyHasPersonInfo(evidence):
			supported = append(supported, claim)
		case claim == "time_info" && timeInfoRe.MatchString(combinedText):
			supported = append(supported, claim)
		case claim == "location_info" && locationInfoRe.MatchString(combinedText):
			supported = append(supported, claim)
		case claim == "quantity_value" && quantityRe.MatchString(combinedText):
			supported = append(supported, claim)
		case claim == "factual_data" && len(evidence) > 0:
			supported = append(supported, claim)
		case claim == "aggregated_value" && hasSQLSource:
			supported = append(supported, claim)
		case strings.HasPrefix(claim, "comparison_item_") && len(evidence) >= 2:
			supported = append(supported, claim)
		case claim == "concept_definition" && len([]rune(combinedText)) > 100:
			supported = append(supported, claim)
		case claim == "relationship_info" && hasGraphSource:
			supported = append(supported, claim)
		case strings.HasPrefix(claim, "entity_"):
			entityName := strings.TrimPrefix(claim, "entity_")
			if strings.Contains(combinedText, entityName) {
				supported = append(supported, claim)
			}
		case claim == "intermediate_result" && len(evidence) >= 1:
			supported = append(supported, claim)
		case claim == "final_result" && len(evidence) > 0:
			supported = append(supported, claim)
		case claim == "reason_explanation" && len([]rune(combinedText)) > 50:
			supported = append(supported, claim)
		case claim == "method_process" && len([]rune(combinedText)) > 50:
			supported = append(supported, claim)
		}
	}

	return supported
}

func anyHasPersonInfo(evidence []agentcontext.ContextItem) bool {
	for _, e := range evidence {
		if hasPersonInfo(e.Text) {
			return true
		}
	}
	return false
}

func hasPersonInfo(text string) bool {
	return personInfoRe1.MatchString(text) || personInfoRe2.MatchString(text)
}

func determineGateAction(coverage float64, missingClaims []string, profile QueryProfile, threshold float64) GateAction {
	switch {
	case coverage >= threshold:
		return ActionProceed
	case coverage >= 0.5:
		for _, c := range missingClaims {
			if c == "factual_data" || c == "aggregated_value" || c == "quantity_value" {
				return ActionSearchMore
			}
		}
		return ActionPartialAnswer
	case coverage >= 0.3:
		if profile.Intent == IntentExplanation {
			return ActionPartialAnswer
		}
		return ActionSearchMore
	default:
		return ActionDecline
	}
}

func buildGateReasoning(coverage float64, required, supported int, action GateAction) string {
	return fmt.Sprintf("커버리지 %.0f%% (%d/%d 클레임) → %s", coverage*100, supported, required, action)
}
