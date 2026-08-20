package core

import "github.com/riwonace/agent-app-go/internal/router"

type NodeStatus string

const (
	NodePending NodeStatus = "PENDING"
	NodeRunning NodeStatus = "RUNNING"
	NodeSuccess NodeStatus = "SUCCESS"
	NodeFailed  NodeStatus = "FAILED"
	NodeSkipped NodeStatus = "SKIPPED"
)

type ConditionType string

const (
	ConditionNotEmpty  ConditionType = "NOT_EMPTY"
	ConditionContains  ConditionType = "CONTAINS"
	ConditionThreshold ConditionType = "THRESHOLD"
	ConditionOnFailure ConditionType = "ON_FAILURE"
	ConditionAlways    ConditionType = "ALWAYS"
)

type FailureType string

const (
	FailureRouteMiss         FailureType = "ROUTE_MISS"
	FailureRetrievalEmpty    FailureType = "RETRIEVAL_EMPTY"
	FailureSQLSchemaError    FailureType = "SQL_SCHEMA_ERROR"
	FailureSQLSyntaxError    FailureType = "SQL_SYNTAX_ERROR"
	FailureEvidenceConflict  FailureType = "EVIDENCE_CONFLICT"
	FailureMCPTimeout        FailureType = "MCP_TIMEOUT"
	FailureMCPConnectionErr  FailureType = "MCP_CONNECTION_ERROR"
	FailureUnknown           FailureType = "UNKNOWN"
)

// ExecutionCondition mirrors data class ExecutionCondition.
type ExecutionCondition struct {
	Type     ConditionType
	Variable string
}

// PlanNode mirrors data class PlanNode.
type PlanNode struct {
	ID             string
	Route          router.Route
	InputTemplate  string
	DependsOn      []string
	Condition      *ExecutionCondition
	OutputBinding  string
	Status         NodeStatus
}

// ExecutionPlan mirrors data class ExecutionPlan.
type ExecutionPlan struct {
	Question       string
	Nodes          []*PlanNode
	Profile        QueryProfile
	SelectedModel  string
	PlanningTimeMs int64
}

// NodeTrace mirrors data class NodeTrace.
type NodeTrace struct {
	NodeID        string
	Route         router.Route
	Status        NodeStatus
	StartedAt     int64
	EndedAt       int64
	ResultSummary string
}

// ExecutionTrace mirrors data class ExecutionTrace.
type ExecutionTrace struct {
	Plan             ExecutionPlan
	NodeTraces       []NodeTrace
	TotalDurationMs  int64
	FinalAnswer      string
	EvidenceSources  []string
	ClaimCoverage    float64
}
