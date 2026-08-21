// Package context ports com.riwonace.agent.context from the Kotlin/Spring AI baseline.
package context

// ContextItem mirrors data class ContextItem.
type ContextItem struct {
	Source string
	Text   string
	Score  float64
}
