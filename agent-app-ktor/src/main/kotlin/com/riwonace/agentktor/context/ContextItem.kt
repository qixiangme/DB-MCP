package com.riwonace.agentktor.context

/** Ports ContextItem from com.riwonace.agentktor.context.ContextCurator.kt 1:1 (ContextCurator
 * itself, a v1-only component, is out of this port's scope -- same scope decision as
 * agent-app-go's port, which targets AgentServiceV2 only). */
data class ContextItem(
    val source: String,
    val text: String,
    val score: Double,
)
