package com.riwonace.agentktor.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.riwonace.agentktor.core.NodeStatus
import com.riwonace.agentktor.mcp.McpGateway
import com.riwonace.agentktor.service.AgentServiceV2
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

/** Ports ChatController.kt's request/response DTOs 1:1 (v2 path only, matching this port's scope). */
data class ChatRequest(val question: String)

data class ChatResponseV2(
    val answer: String,
    val routes: List<String>,
    val toolCalls: List<String>,
    val contextSources: List<String>,
    val latencyMs: Long,
    val selectedModel: String?,
    val claimCoverage: Double?,
    val wasEscalated: Boolean,
    val trace: ExecutionTraceSummary?,
)

data class ExecutionTraceSummary(
    val totalNodes: Int,
    val successNodes: Int,
    val failedNodes: Int,
    val skippedNodes: Int,
    val nodes: List<NodeTraceSummary>,
    val planningTimeMs: Long,
    val intent: String,
    val complexity: Double,
)

data class NodeTraceSummary(
    val id: String,
    val route: String,
    val status: String,
    val durationMs: Long,
    val resultSummary: String?,
)

private val controlCharsRegex = Regex("[\\x00-\\x1F\\x7F]")

private fun sanitizeInput(input: String): String = input.trim().replace(controlCharsRegex, "")

private fun validQuestion(question: String): Boolean = question.isNotBlank() && question.length in 2..2000

/** Ports ChatController.kt 1:1: same endpoints, same response shapes. */
fun Route.chatRoutes(agentServiceV2: AgentServiceV2, gateway: McpGateway, mapper: ObjectMapper) {
    post("/api/chat") {
        val request = call.receive<ChatRequest>()
        val question = sanitizeInput(request.question)
        if (!validQuestion(question)) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "질문은 2자 이상 2000자 이하여야 합니다."))
            return@post
        }
        val result = agentServiceV2.chat(question)
        call.respond(toChatResponseV2(result, null))
    }

    post("/api/chat/v2") {
        val request = call.receive<ChatRequest>()
        val question = sanitizeInput(request.question)
        if (!validQuestion(question)) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "질문은 2자 이상 2000자 이하여야 합니다."))
            return@post
        }
        val trace = call.request.queryParameters["trace"]?.toBoolean() ?: false
        val result = agentServiceV2.chat(question)
        val traceSummary = if (trace && result.trace != null) toTraceSummary(result.trace!!) else null
        call.respond(toChatResponseV2(result, traceSummary))
    }

    get("/api/tools") {
        call.respond(
            mapOf(
                "mcpTools" to gateway.listToolNames(),
                "mcpResources" to gateway.listResourceUris(),
            ),
        )
    }

    get("/api/v2/status") {
        call.respond(
            mapOf(
                "v2Enabled" to true,
                "features" to listOf(
                    "Adaptive Model Escalation",
                    "Execution DAG",
                    "Evidence Budget Optimizer",
                    "Answerability Gate",
                    "Recovery Policy",
                ),
            ),
        )
    }
}

private fun toChatResponseV2(result: AgentServiceV2.AgentAnswerV2, trace: ExecutionTraceSummary?) = ChatResponseV2(
    answer = result.answer,
    routes = result.routes.map { it.name },
    toolCalls = result.toolCalls,
    contextSources = result.contextSources,
    latencyMs = result.latencyMs,
    selectedModel = result.selectedModel,
    claimCoverage = result.claimCoverage,
    wasEscalated = result.wasEscalated,
    trace = trace,
)

private fun toTraceSummary(trace: com.riwonace.agentktor.core.ExecutionTrace): ExecutionTraceSummary {
    val nodes = trace.nodeTraces.map { nt ->
        NodeTraceSummary(
            id = nt.nodeId,
            route = nt.route.name,
            status = nt.status.name,
            durationMs = (nt.endedAt ?: System.currentTimeMillis()) - nt.startedAt,
            resultSummary = nt.resultSummary,
        )
    }
    return ExecutionTraceSummary(
        totalNodes = trace.plan.nodes.size,
        successNodes = trace.nodeTraces.count { it.status == NodeStatus.SUCCESS },
        failedNodes = trace.nodeTraces.count { it.status == NodeStatus.FAILED },
        skippedNodes = trace.nodeTraces.count { it.status == NodeStatus.SKIPPED },
        nodes = nodes,
        planningTimeMs = trace.plan.planningTimeMs,
        intent = trace.plan.profile.intent.name,
        complexity = trace.plan.profile.complexity,
    )
}
