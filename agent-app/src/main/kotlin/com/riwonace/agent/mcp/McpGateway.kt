package com.riwonace.agent.mcp

import io.modelcontextprotocol.client.McpSyncClient
import io.modelcontextprotocol.spec.McpSchema
import org.springframework.stereotype.Component
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** 단일 MCP 세션에서 요청/응답 ID가 섞이지 않도록 프로토콜 호출을 직렬화한다. */
internal class McpSessionGuard {
    private val lock = ReentrantLock()

    fun <T> execute(block: () -> T): T = lock.withLock(block)
}

/**
 * MCP 서버 도구 호출 게이트웨이.
 * 에이전트가 아는 유일한 외부 연결점 — 장애 지점이 이 연결 하나로 수렴한다.
 */
@Component
class McpGateway(private val clients: List<McpSyncClient>) {

    private val cachedSchema = AtomicReference<String?>(null)
    private val sessionGuard = McpSessionGuard()

    private val client: McpSyncClient
        get() = clients.firstOrNull()
            ?: error("MCP 서버에 연결되어 있지 않습니다. mcp-server(8081)가 기동 중인지 확인하세요.")

    fun vectorSearch(query: String, topK: Int = 4): String =
        callTool("vector_search", mapOf("query" to query, "topK" to topK))

    fun runSql(sql: String): String =
        callTool("run_sql", mapOf("sql" to sql))

    fun kgSearch(query: String): String =
        callTool("kg_search", mapOf("query" to query))

    fun schema(): String =
        cachedSchema.get() ?: callTool("get_schema", emptyMap()).also { cachedSchema.set(it) }

    fun listToolNames(): List<String> =
        sessionGuard.execute {
            client.listTools().tools().map { it.name() }
        }

    private fun callTool(name: String, args: Map<String, Any>): String =
        sessionGuard.execute {
            val result = client.callTool(McpSchema.CallToolRequest(name, args))
            result.content()
                .filterIsInstance<McpSchema.TextContent>()
                .joinToString("\n") { it.text() }
        }
}
