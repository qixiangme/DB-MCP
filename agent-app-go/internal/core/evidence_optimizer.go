package core

import (
	"regexp"
	"sort"
	"strconv"
	"strings"

	agentcontext "github.com/riwonace/agent-app-go/internal/context"
	"github.com/riwonace/agent-app-go/internal/router"
)

const (
	MinRelevance      = 0.3
	DuplicateThreshold = 0.8
)

var reliabilityWeights = map[string]float64{
	"sql":             1.0,
	"knowledge-graph": 0.9,
	"document":        0.7,
	"vector":          0.6,
}

var hasDigitRe = regexp.MustCompile(`\d+`)

// OptimizationResult mirrors data class OptimizationResult.
type OptimizationResult struct {
	Selected          []agentcontext.ContextItem
	TotalValue        float64
	UsedBudget        int
	ExcludedCount     int
	DeduplicatedCount int
	Reasoning         string
}

// EvidenceOptimizer ports EvidenceOptimizer.kt 1:1: greedy value/cost evidence selection
// within a character budget.
type EvidenceOptimizer struct {
	BudgetChars int
}

type scoredItem struct {
	item agentcontext.ContextItem
	value float64
	cost  int
}

func (o *EvidenceOptimizer) Optimize(items []agentcontext.ContextItem, routes []router.Route, profile QueryProfile) OptimizationResult {
	if len(items) == 0 {
		return OptimizationResult{Reasoning: "증거 항목 없음"}
	}

	var filtered []agentcontext.ContextItem
	for _, it := range items {
		if it.Score >= MinRelevance {
			filtered = append(filtered, it)
		}
	}
	filteredOutCount := len(items) - len(filtered)

	deduplicated := deduplicateItems(filtered)
	deduplicatedCount := len(filtered) - len(deduplicated)

	scored := make([]scoredItem, 0, len(deduplicated))
	for _, it := range deduplicated {
		scored = append(scored, scoredItem{
			item:  it,
			value: calculateValue(it, routes, profile),
			cost:  len([]rune(it.Text)),
		})
	}

	sort.SliceStable(scored, func(i, j int) bool {
		ci := scored[i].cost
		if ci < 1 {
			ci = 1
		}
		cj := scored[j].cost
		if cj < 1 {
			cj = 1
		}
		return scored[i].value/float64(ci) > scored[j].value/float64(cj)
	})

	var selected []scoredItem
	remainingBudget := effectiveBudget(routes, o.BudgetChars)

	for _, s := range scored {
		if s.cost <= remainingBudget {
			selected = append(selected, s)
			remainingBudget -= s.cost
		} else if len(selected) == 0 {
			runes := []rune(s.item.Text)
			cut := remainingBudget - 12
			if cut < 0 {
				cut = 0
			}
			if cut > len(runes) {
				cut = len(runes)
			}
			truncatedText := string(runes[:cut]) + "…(truncated)"
			truncated := scoredItem{
				item: agentcontext.ContextItem{Source: s.item.Source, Text: truncatedText, Score: s.item.Score},
				value: s.value,
				cost:  remainingBudget,
			}
			selected = append(selected, truncated)
			remainingBudget = 0
			break
		}
	}

	selectedItems := make([]agentcontext.ContextItem, 0, len(selected))
	for _, s := range selected {
		selectedItems = append(selectedItems, s.item)
	}
	finalSelected := applyLostInMiddleMitigation(selectedItems)

	totalValue := 0.0
	usedBudget := 0
	for _, s := range selected {
		totalValue += s.value
		usedBudget += s.cost
	}

	return OptimizationResult{
		Selected:          finalSelected,
		TotalValue:        totalValue,
		UsedBudget:        usedBudget,
		ExcludedCount:     filteredOutCount + (len(deduplicated) - len(selected)),
		DeduplicatedCount: deduplicatedCount,
		Reasoning:         buildOptimizerReasoning(len(selected), filteredOutCount, deduplicatedCount, totalValue),
	}
}

func calculateValue(item agentcontext.ContextItem, routes []router.Route, profile QueryProfile) float64 {
	relevance := item.Score
	reliability, ok := reliabilityWeights[item.Source]
	if !ok {
		reliability = 0.5
	}
	answerability := calculateAnswerability(item, profile)
	novelty := calculateNovelty(item, routes)
	return relevance * reliability * answerability * novelty
}

func calculateAnswerability(item agentcontext.ContextItem, profile QueryProfile) float64 {
	score := 1.0
	switch profile.Intent {
	case IntentFactual, IntentAggregation:
		if hasDigitRe.MatchString(item.Text) {
			score *= 1.2
		}
		if item.Source == "sql" {
			score *= 1.3
		}
	case IntentComparison:
		if countDigits(item.Text) >= 2 {
			score *= 1.2
		}
	case IntentExplanation:
		if len([]rune(item.Text)) > 200 {
			score *= 1.1
		}
	case IntentRelation:
		if item.Source == "knowledge-graph" {
			score *= 1.3
		}
	case IntentMultiHop:
		score *= 1.0
	}
	if score > 1.5 {
		return 1.5
	}
	return score
}

func countDigits(s string) int {
	n := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			n++
		}
	}
	return n
}

func calculateNovelty(item agentcontext.ContextItem, routes []router.Route) float64 {
	sourceToRoute := map[string]router.Route{
		"sql":             router.RouteSQL,
		"knowledge-graph": router.RouteGraph,
		"document":        router.RouteVector,
		"vector":          router.RouteVector,
	}
	itemRoute, ok := sourceToRoute[item.Source]
	if ok {
		for _, r := range routes {
			if r == itemRoute {
				return 1.2
			}
		}
	}
	return 0.8
}

var wsRe = regexp.MustCompile(`\s+`)

func deduplicateItems(items []agentcontext.ContextItem) []agentcontext.ContextItem {
	if len(items) <= 1 {
		return items
	}
	sorted := append([]agentcontext.ContextItem{}, items...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Score > sorted[j].Score })

	seen := make(map[string]bool)
	var result []agentcontext.ContextItem
	for _, it := range sorted {
		normalized := strings.TrimSpace(wsRe.ReplaceAllString(it.Text, " "))
		runes := []rune(normalized)
		if len(runes) > 100 {
			runes = runes[:100]
		}
		hash := string(runes)
		if !seen[hash] {
			seen[hash] = true
			result = append(result, it)
		}
	}
	return result
}

func applyLostInMiddleMitigation(items []agentcontext.ContextItem) []agentcontext.ContextItem {
	if len(items) < 3 {
		return items
	}
	result := append([]agentcontext.ContextItem{}, items...)
	second := result[1]
	result = append(result[:1], result[2:]...)
	result = append(result, second)
	return result
}

func effectiveBudget(routes []router.Route, budgetChars int) int {
	if len(routes) == 1 && routes[0] == router.RouteSQL {
		return budgetChars / 2
	}
	return budgetChars
}

func buildOptimizerReasoning(selectedCount, filteredOut, deduplicated int, totalValue float64) string {
	parts := []string{strconv.Itoa(selectedCount) + "개 증거 선택"}
	if filteredOut > 0 {
		parts = append(parts, "관련도 미달 "+strconv.Itoa(filteredOut)+"개 제외")
	}
	if deduplicated > 0 {
		parts = append(parts, "중복 "+strconv.Itoa(deduplicated)+"개 제거")
	}
	return strings.Join(parts, ", ")
}
