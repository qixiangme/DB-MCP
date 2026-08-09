package com.riwonace.agent.mcp

import io.modelcontextprotocol.client.McpSyncClient
import io.modelcontextprotocol.spec.McpSchema
import org.springframework.stereotype.Component
import java.util.concurrent.atomic.AtomicReference

/**
 * MCP 서버 도구 호출 게이트웨이.
 * 에이전트의 데이터 접근을 MCP 한 경계로 모으는 게이트웨이.
 * DB·벡터·그래프별 접속 세부사항은 서버 뒤에 두고, 답변 생성용 Ollama 연결과는 구분한다.
 */
@Component
class McpGateway(private val clients: List<McpSyncClient>) {

    private val cachedSchema = AtomicReference<String?>(null)

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
        cachedSchema.get() ?: readTextResource(SCHEMA_URI).also { cachedSchema.set(it) }

    fun listToolNames(): List<String> =
        client.listTools().tools().map { it.name() }

    fun listResourceUris(): List<String> =
        client.listResources().resources().map { it.uri() }

    private fun callTool(name: String, args: Map<String, Any>): String {
        val result = client.callTool(McpSchema.CallToolRequest(name, args))
        return result.content()
            .filterIsInstance<McpSchema.TextContent>()
            .joinToString("\n") { it.text() }
    }

    private fun readTextResource(uri: String): String {
        val result = client.readResource(McpSchema.ReadResourceRequest(uri))
        val text = result.contents()
            .filterIsInstance<McpSchema.TextResourceContents>()
            .joinToString("\n") { it.text() }
        check(text.isNotBlank()) { "MCP Resource가 비어 있습니다: $uri" }
        return text
    }

    companion object {
        const val SCHEMA_URI = "db://schema"
    }
}
