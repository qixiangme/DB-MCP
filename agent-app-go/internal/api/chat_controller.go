// Package api ports com.riwonace.agent.api.ChatController from the Kotlin/Spring AI baseline.
package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/riwonace/agent-app-go/internal/core"
	agentmcp "github.com/riwonace/agent-app-go/internal/mcp"
	"github.com/riwonace/agent-app-go/internal/service"
)

// ChatRequest mirrors data class ChatRequest: question must be 2..2000 chars, non-blank.
type ChatRequest struct {
	Question string `json:"question"`
}

// ChatResponseV2 mirrors data class ChatResponseV2.
type ChatResponseV2 struct {
	Answer         string                 `json:"answer"`
	Routes         []string               `json:"routes"`
	ToolCalls      []string               `json:"toolCalls"`
	ContextSources []string               `json:"contextSources"`
	LatencyMs      int64                  `json:"latencyMs"`
	SelectedModel  string                 `json:"selectedModel"`
	ClaimCoverage  float64                `json:"claimCoverage"`
	WasEscalated   bool                   `json:"wasEscalated"`
	Trace          *ExecutionTraceSummary `json:"trace,omitempty"`
}

// ExecutionTraceSummary mirrors data class ExecutionTraceSummary.
type ExecutionTraceSummary struct {
	TotalNodes     int                 `json:"totalNodes"`
	SuccessNodes   int                 `json:"successNodes"`
	FailedNodes    int                 `json:"failedNodes"`
	SkippedNodes   int                 `json:"skippedNodes"`
	Nodes          []NodeTraceSummary  `json:"nodes"`
	PlanningTimeMs int64               `json:"planningTimeMs"`
	Intent         string              `json:"intent"`
	Complexity     float64             `json:"complexity"`
}

// NodeTraceSummary mirrors data class NodeTraceSummary.
type NodeTraceSummary struct {
	ID            string `json:"id"`
	Route         string `json:"route"`
	Status        string `json:"status"`
	DurationMs    int64  `json:"durationMs"`
	ResultSummary string `json:"resultSummary"`
}

var controlCharsRe = regexp.MustCompile("[\x00-\x1F\x7F]")

// ChatController ports ChatController.kt 1:1 (v2-only: this port's scope targets
// AgentServiceV2, the current production path; v1/AgentService is not ported).
type ChatController struct {
	AgentServiceV2 *service.AgentServiceV2
	Gateway        *agentmcp.Gateway
}

func sanitizeInput(input string) string {
	return controlCharsRe.ReplaceAllString(strings.TrimSpace(input), "")
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func decodeChatRequest(r *http.Request) (ChatRequest, error) {
	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, err
	}
	return req, nil
}

func validateQuestion(question string) bool {
	n := len([]rune(question))
	return strings.TrimSpace(question) != "" && n >= 2 && n <= 2000
}

// HandleChat implements POST /api/chat (v2 path only, per this port's scope).
func (c *ChatController) HandleChat(w http.ResponseWriter, r *http.Request) {
	req, err := decodeChatRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "잘못된 요청 본문입니다."})
		return
	}
	question := sanitizeInput(req.Question)
	if !validateQuestion(question) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "질문은 2자 이상 2000자 이하여야 합니다."})
		return
	}

	result := c.AgentServiceV2.Chat(r.Context(), question)
	writeJSON(w, http.StatusOK, toChatResponseV2(result, nil))
}

// HandleChatV2 implements POST /api/chat/v2?trace=true.
func (c *ChatController) HandleChatV2(w http.ResponseWriter, r *http.Request) {
	req, err := decodeChatRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "잘못된 요청 본문입니다."})
		return
	}
	question := sanitizeInput(req.Question)
	if !validateQuestion(question) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "질문은 2자 이상 2000자 이하여야 합니다."})
		return
	}

	trace, _ := strconv.ParseBool(r.URL.Query().Get("trace"))

	result := c.AgentServiceV2.Chat(r.Context(), question)

	var traceSummary *ExecutionTraceSummary
	if trace && result.Trace != nil {
		traceSummary = toTraceSummary(result.Trace)
	}

	writeJSON(w, http.StatusOK, toChatResponseV2(result, traceSummary))
}

// HandleTools implements GET /api/tools.
func (c *ChatController) HandleTools(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tools, err := c.Gateway.ListToolNames(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	resources, err := c.Gateway.ListResourceURIs(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mcpTools": tools, "mcpResources": resources})
}

// HandleV2Status implements GET /api/v2/status.
func (c *ChatController) HandleV2Status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"v2Enabled": true,
		"features": []string{
			"Adaptive Model Escalation",
			"Execution DAG",
			"Evidence Budget Optimizer",
			"Answerability Gate",
			"Recovery Policy",
		},
	})
}

func toChatResponseV2(result service.AgentAnswerV2, trace *ExecutionTraceSummary) ChatResponseV2 {
	routes := make([]string, len(result.Routes))
	for i, r := range result.Routes {
		routes[i] = string(r)
	}
	return ChatResponseV2{
		Answer:         result.Answer,
		Routes:         routes,
		ToolCalls:      result.ToolCalls,
		ContextSources: result.ContextSources,
		LatencyMs:      result.LatencyMs,
		SelectedModel:  result.SelectedModel,
		ClaimCoverage:  result.ClaimCoverage,
		WasEscalated:   result.WasEscalated,
		Trace:          trace,
	}
}

func toTraceSummary(trace *core.ExecutionTrace) *ExecutionTraceSummary {
	var successNodes, failedNodes, skippedNodes int
	nodes := make([]NodeTraceSummary, len(trace.NodeTraces))
	for i, nt := range trace.NodeTraces {
		switch nt.Status {
		case core.NodeSuccess:
			successNodes++
		case core.NodeFailed:
			failedNodes++
		case core.NodeSkipped:
			skippedNodes++
		}
		endedAt := nt.EndedAt
		duration := endedAt - nt.StartedAt
		nodes[i] = NodeTraceSummary{
			ID:            nt.NodeID,
			Route:         string(nt.Route),
			Status:        string(nt.Status),
			DurationMs:    duration,
			ResultSummary: nt.ResultSummary,
		}
	}

	return &ExecutionTraceSummary{
		TotalNodes:     len(trace.Plan.Nodes),
		SuccessNodes:   successNodes,
		FailedNodes:    failedNodes,
		SkippedNodes:   skippedNodes,
		Nodes:          nodes,
		PlanningTimeMs: trace.Plan.PlanningTimeMs,
		Intent:         string(trace.Plan.Profile.Intent),
		Complexity:     trace.Plan.Profile.Complexity,
	}
}
