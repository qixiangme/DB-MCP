package com.riwonace.mcpktor.tools

import io.modelcontextprotocol.server.McpServerFeatures
import io.modelcontextprotocol.spec.McpSchema

/**
 * Registers RetrievalTools' 3 methods as MCP SyncToolSpecifications. This is the
 * Ktor-port equivalent of McpServerApplication's `riwonaceTools` bean
 * (MethodToolCallbackProvider.builder().toolObjects(retrievalTools).build()), which
 * reflects over @Tool-annotated methods; here registration is explicit since this SDK
 * has no annotation-scanning tool-callback layer of its own.
 */
object ToolRegistration {
    /** The exact tool-name set this MCP server exposes -- mirrors RetrievalToolsContractTest. */
    val TOOL_NAMES = setOf("vector_search", "run_sql", "kg_search")

    fun specifications(tools: RetrievalTools): List<McpServerFeatures.SyncToolSpecification> = listOf(
        McpServerFeatures.SyncToolSpecification(
            McpSchema.Tool(
                "vector_search",
                "사내 기술 문서 저장소에서 질문과 의미적으로 유사한 문서를 벡터 검색한다. " +
                    "개념 설명, 기술 소개, 정책·가이드 질문에 사용한다.",
                """{"type":"object","properties":{"query":{"type":"string","description":"검색할 자연어 질의"},"topK":{"type":"integer","description":"가져올 문서 수 (1~10, 기본 4)"}},"required":["query"]}""",
            ),
        ) { _, args ->
            val query = args["query"] as String
            val topK = (args["topK"] as? Number)?.toInt()
            McpSchema.CallToolResult(listOf(McpSchema.TextContent(tools.vectorSearch(query, topK))), false)
        },
        McpServerFeatures.SyncToolSpecification(
            McpSchema.Tool(
                "run_sql",
                "NL2SQL 경로가 만든 읽기 전용 SELECT SQL 한 문장을 검증·실행하고 결과를 JSON으로 반환한다. " +
                    "집계·통계·목록 등 정형 데이터 질문에 사용한다. INSERT/UPDATE/DELETE는 거부된다.",
                """{"type":"object","properties":{"sql":{"type":"string","description":"실행할 PostgreSQL SELECT 문"}},"required":["sql"]}""",
            ),
        ) { _, args ->
            val sql = args["sql"] as String
            McpSchema.CallToolResult(listOf(McpSchema.TextContent(tools.runSql(sql))), false)
        },
        McpServerFeatures.SyncToolSpecification(
            McpSchema.Tool(
                "kg_search",
                "온톨로지 기반 지식 그래프에서 엔티티와 관련된 관계(triple)를 조회한다. " +
                    "'A와 B의 관계', '무엇을 개발했나' 같은 개체 간 연결 질문에 사용한다.",
                """{"type":"object","properties":{"query":{"type":"string","description":"관계를 조회할 자연어 질의 또는 엔티티 이름"}},"required":["query"]}""",
            ),
        ) { _, args ->
            val query = args["query"] as String
            McpSchema.CallToolResult(listOf(McpSchema.TextContent(tools.kgSearch(query))), false)
        },
    )
}
