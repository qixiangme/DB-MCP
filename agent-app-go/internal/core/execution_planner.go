package core

import (
	"regexp"
	"strconv"
	"time"

	"github.com/riwonace/agent-app-go/internal/router"
)

// ExecutionPlanner ports ExecutionPlanner.kt 1:1: builds a PlanNode DAG from a
// QueryProfile using one of 4 strategies (simple/parallel/multi-hop/dependent).
type ExecutionPlanner struct {
	Profiler  *QueryProfiler
	Escalator *ModelEscalator
}

func (p *ExecutionPlanner) Plan(question string) ExecutionPlan {
	started := time.Now()

	profile := p.Profiler.Profile(question)
	modelSelection := p.Escalator.SelectModel(profile)

	var nodes []*PlanNode
	switch {
	case profile.HasDependency:
		nodes = createDependentPlan(question, profile)
	case profile.IsMultiHop:
		nodes = createMultiHopPlan(question, profile)
	case len(profile.SuggestedRoutes) > 1:
		nodes = createParallelPlan(question, profile)
	default:
		nodes = createSimplePlan(question, profile)
	}

	planningTime := time.Since(started).Milliseconds()

	return ExecutionPlan{
		Question:       question,
		Nodes:          nodes,
		Profile:        profile,
		SelectedModel:  modelSelection.Model,
		PlanningTimeMs: planningTime,
	}
}

func createSimplePlan(question string, profile QueryProfile) []*PlanNode {
	route := router.RouteVector
	if len(profile.SuggestedRoutes) > 0 {
		route = profile.SuggestedRoutes[0]
	}
	return []*PlanNode{
		{ID: "node-1", Route: route, InputTemplate: question, OutputBinding: "result_1"},
	}
}

func createParallelPlan(question string, profile QueryProfile) []*PlanNode {
	nodes := make([]*PlanNode, 0, len(profile.SuggestedRoutes))
	for i, route := range profile.SuggestedRoutes {
		nodes = append(nodes, &PlanNode{
			ID:            nodeID(i + 1),
			Route:         route,
			InputTemplate: question,
			OutputBinding: outputBinding(i + 1),
		})
	}
	return nodes
}

func createMultiHopPlan(question string, profile QueryProfile) []*PlanNode {
	routes := profile.SuggestedRoutes
	if len(routes) == 0 {
		routes = []router.Route{router.RouteSQL, router.RouteVector}
	}

	var nodes []*PlanNode
	for i, route := range routes {
		isFirst := i == 0
		var dependsOn []string
		var condition *ExecutionCondition
		inputTemplate := question
		if !isFirst {
			dependsOn = []string{nodeID(i)}
			condition = &ExecutionCondition{Type: ConditionNotEmpty, Variable: outputVar(i)}
			inputTemplate = question + " (이전 결과: ${" + outputVar(i) + "})"
		}
		nodes = append(nodes, &PlanNode{
			ID:            nodeID(i + 1),
			Route:         route,
			InputTemplate: inputTemplate,
			DependsOn:     dependsOn,
			Condition:     condition,
			OutputBinding: outputBinding(i + 1),
		})
	}
	return nodes
}

var (
	structuredPattern1 = regexp.MustCompile(`(상위|하위|최근|처음)\s*(\d+)\s*(개|건|명|개의|건의|명의)`)
	structuredPattern2 = regexp.MustCompile(`(가장|제일)\s*(높은|낮은|많은|적은|큰|작은)`)
)

func createDependentPlan(question string, profile QueryProfile) []*PlanNode {
	var nodes []*PlanNode
	hasStructuredFirst := profile.RequiredEvidence[EvidenceStructuredData]

	if hasStructuredFirst {
		nodes = append(nodes, &PlanNode{
			ID:            "sql-identify",
			Route:         router.RouteSQL,
			InputTemplate: extractStructuredQuery(question),
			OutputBinding: "entities",
		})
		nodes = append(nodes, &PlanNode{
			ID:            "vector-detail",
			Route:         router.RouteVector,
			InputTemplate: "${entities}에 대한 상세 정보",
			DependsOn:     []string{"sql-identify"},
			Condition:     &ExecutionCondition{Type: ConditionNotEmpty, Variable: "entities"},
			OutputBinding: "details",
		})
		nodes = append(nodes, &PlanNode{
			ID:            "vector-fallback",
			Route:         router.RouteVector,
			InputTemplate: question,
			DependsOn:     []string{"sql-identify"},
			Condition:     &ExecutionCondition{Type: ConditionOnFailure, Variable: "entities"},
			OutputBinding: "fallback_result",
		})
	} else {
		nodes = append(nodes, &PlanNode{
			ID:            "vector-context",
			Route:         router.RouteVector,
			InputTemplate: question,
			OutputBinding: "context",
		})
		nodes = append(nodes, &PlanNode{
			ID:            "sql-verify",
			Route:         router.RouteSQL,
			InputTemplate: "${context}를 검증하는 데이터 조회",
			DependsOn:     []string{"vector-context"},
			Condition:     &ExecutionCondition{Type: ConditionNotEmpty, Variable: "context"},
			OutputBinding: "verification",
		})
	}

	return nodes
}

func extractStructuredQuery(question string) string {
	for _, pattern := range []*regexp.Regexp{structuredPattern1, structuredPattern2} {
		loc := pattern.FindStringIndex(question)
		if loc != nil {
			runes := []rune(question)
			// FindStringIndex returns byte offsets; convert to a rune-safe window by
			// operating on the byte-sliced match position translated to rune indices.
			start := byteIndexToRuneIndex(question, loc[0]) - 20
			if start < 0 {
				start = 0
			}
			end := byteIndexToRuneIndex(question, loc[1]) + 20
			if end > len(runes) {
				end = len(runes)
			}
			return string(runes[start:end])
		}
	}
	return question
}

func byteIndexToRuneIndex(s string, byteIdx int) int {
	count := 0
	for i := range s {
		if i >= byteIdx {
			return count
		}
		count++
	}
	return count
}

func nodeID(n int) string {
	return "node-" + strconv.Itoa(n)
}

func outputBinding(n int) string {
	return "result_" + strconv.Itoa(n)
}

func outputVar(n int) string {
	return "result_" + strconv.Itoa(n)
}
