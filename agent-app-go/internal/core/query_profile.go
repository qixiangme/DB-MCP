// Package core ports com.riwonace.agent.core from the Kotlin/Spring AI baseline.
package core

import "github.com/riwonace/agent-app-go/internal/router"

// QueryIntent mirrors QueryProfile.kt's enum QueryIntent.
type QueryIntent string

const (
	IntentFactual    QueryIntent = "FACTUAL"
	IntentAggregation QueryIntent = "AGGREGATION"
	IntentComparison QueryIntent = "COMPARISON"
	IntentExplanation QueryIntent = "EXPLANATION"
	IntentMultiHop   QueryIntent = "MULTI_HOP"
	IntentRelation   QueryIntent = "RELATION"
)

// EvidenceType mirrors QueryProfile.kt's enum EvidenceType.
type EvidenceType string

const (
	EvidenceStructuredData EvidenceType = "STRUCTURED_DATA"
	EvidenceDocument       EvidenceType = "DOCUMENT"
	EvidenceGraphRelation  EvidenceType = "GRAPH_RELATION"
)

// QueryProfile mirrors data class QueryProfile.
type QueryProfile struct {
	Intent          QueryIntent
	Complexity      float64
	Uncertainty     float64
	RequiredEvidence map[EvidenceType]bool
	SuggestedRoutes []router.Route
	IsMultiHop      bool
	HasDependency   bool
}
