package com.riwonace.mcpktor.resources

import io.modelcontextprotocol.server.McpServerFeatures
import io.modelcontextprotocol.spec.McpSchema

/** Ports SchemaResourceConfiguration.kt 1:1: registers db://schema as an MCP Resource. */
object SchemaResourceRegistration {
    const val SCHEMA_URI = "db://schema"

    fun specification(schemaCatalog: SchemaCatalog): McpServerFeatures.SyncResourceSpecification {
        val resource = McpSchema.Resource(
            SCHEMA_URI,
            "database-schema",
            "NL2SQL 생성에 필요한 테이블·컬럼·외래키·저카디널리티 값 힌트",
            "application/json",
            null,
        )
        return McpServerFeatures.SyncResourceSpecification(resource) { _, request ->
            McpSchema.ReadResourceResult(
                listOf(McpSchema.TextResourceContents(request.uri(), "application/json", schemaCatalog.readJson())),
            )
        }
    }
}
