package com.riwonace.agentktor

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.riwonace.agentktor.api.chatRoutes
import com.riwonace.agentktor.core.*
import com.riwonace.agentktor.llm.OllamaChatClient
import com.riwonace.agentktor.mcp.McpGateway
import com.riwonace.agentktor.router.RuleBasedRouter
import com.riwonace.agentktor.service.AgentServiceV2
import com.riwonace.agentktor.sql.FewShotSelector
import com.riwonace.agentktor.sql.SchemaLinker
import com.riwonace.agentktor.sql.SchemaPromptFormatter
import io.ktor.serialization.jackson.jackson
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.routing.*
import io.modelcontextprotocol.client.McpClient
import io.modelcontextprotocol.client.transport.HttpClientSseClientTransport
import java.time.Duration

/**
 * agent-app-ktor entrypoint: a 1:1 Ktor port of agent-app (Kotlin/Spring AI),
 * Architecture v2 orchestration path only. Talks to an MCP server (mcp-server,
 * mcp-server-go, or mcp-server-ktor) over SSE using the same core Kotlin MCP SDK
 * mcp-server-ktor's client side ships a ready client-side SSE transport for
 * (HttpClientSseClientTransport) -- no custom transport code needed here, unlike the
 * server side.
 */
fun main() {
    val port = System.getenv("SERVER_PORT")?.toIntOrNull() ?: 8080
    val mcpServerUrl = System.getenv("MCP_SERVER_URL") ?: "http://localhost:8081"
    val ollamaBaseUrl = System.getenv("OLLAMA_BASE_URL") ?: "http://localhost:11434"
    val ollamaModel = System.getenv("OLLAMA_MODEL") ?: "gemma3:1b"

    val mapper: ObjectMapper = jacksonObjectMapper()

    val transport = HttpClientSseClientTransport(mcpServerUrl)
    val mcpClient = McpClient.sync(transport)
        .requestTimeout(Duration.ofSeconds(120))
        .build()
    mcpClient.initialize()

    val gateway = McpGateway(listOf(mcpClient))

    val chatClient = OllamaChatClient(ollamaBaseUrl, ollamaModel, mapper)
    Thread { chatClient.warmup() }.start()

    val ruleRouter = RuleBasedRouter()
    val profiler = QueryProfiler(ruleRouter)
    val escalator = ModelEscalator(
        enabled = true,
        smallModel = System.getenv("ESCALATION_SMALL_MODEL") ?: "gemma3:1b",
        mediumModel = System.getenv("ESCALATION_MEDIUM_MODEL") ?: "qwen2.5:3b",
        largeModel = System.getenv("ESCALATION_LARGE_MODEL") ?: "qwen2.5:7b",
    )
    val planner = ExecutionPlanner(profiler, escalator)
    val optimizer = EvidenceOptimizer(budgetChars = 2400)
    val gate = AnswerabilityGate(coverageThreshold = 0.7, useLlm = false)
    val recovery = RecoveryPolicy()

    val agentService = AgentServiceV2(
        planner = planner,
        optimizer = optimizer,
        gate = gate,
        recovery = recovery,
        escalator = escalator,
        gateway = gateway,
        chatClient = chatClient,
        mapper = mapper,
        fewShotSelector = FewShotSelector(),
        schemaLinker = SchemaLinker(mapper),
        schemaPromptFormatter = SchemaPromptFormatter(mapper),
    )

    Runtime.getRuntime().addShutdownHook(Thread { agentService.shutdown() })

    embeddedServer(Netty, port = port) {
        install(ContentNegotiation) { jackson() }
        routing {
            chatRoutes(agentService, gateway, mapper)
        }
    }.start(wait = true)
}
