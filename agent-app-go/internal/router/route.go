// Package router ports com.riwonace.agent.router from the Kotlin/Spring AI baseline.
package router

// Route mirrors router/RuleBasedRouter.kt's enum Route { SQL, VECTOR, GRAPH }.
type Route string

const (
	RouteSQL    Route = "SQL"
	RouteVector Route = "VECTOR"
	RouteGraph  Route = "GRAPH"
)
