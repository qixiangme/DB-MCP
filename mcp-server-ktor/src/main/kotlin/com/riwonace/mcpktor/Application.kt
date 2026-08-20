package com.riwonace.mcpktor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.riwonace.mcpktor.db.Database
import com.riwonace.mcpktor.embedding.OllamaEmbedder
import com.riwonace.mcpktor.resources.SchemaCatalog
import com.riwonace.mcpktor.resources.SchemaResourceRegistration
import com.riwonace.mcpktor.tools.RetrievalTools
import com.riwonace.mcpktor.tools.ToolRegistration
import com.riwonace.mcpktor.transport.KtorSseServerTransportProvider
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.routing.*
import io.ktor.server.sse.*
import io.modelcontextprotocol.server.McpServer
import io.modelcontextprotocol.spec.McpSchema

/**
 * mcp-server-ktor entrypoint: a 1:1 Ktor port of mcp-server (Kotlin/Spring AI). Same 3
 * MCP tools, same db://schema Resource, same Postgres schema, same Ollama embedding
 * model, same default port (8081). See README for the transport-layer difference this
 * port had to bridge (no Ktor SSE adapter ships with the Kotlin MCP SDK).
 */
fun main() {
    val port = System.getenv("SERVER_PORT")?.toIntOrNull() ?: 8081
    val jdbcUrl = System.getenv("DATABASE_URL") ?: "jdbc:postgresql://localhost:5433/riwonace"
    val dbUser = System.getenv("DATABASE_USER") ?: "riwonace"
    val dbPassword = System.getenv("DATABASE_PASSWORD") ?: "riwonace"
    val ollamaBaseUrl = System.getenv("OLLAMA_BASE_URL") ?: "http://localhost:11434"
    val embeddingModel = System.getenv("OLLAMA_EMBEDDING_MODEL") ?: "nomic-embed-text"

    val mapper = jacksonObjectMapper()
    val db = Database.hikari(jdbcUrl, dbUser, dbPassword)
    val embedder = OllamaEmbedder(ollamaBaseUrl, embeddingModel, mapper)

    val retrievalTools = RetrievalTools(db, embedder, mapper)
    val schemaCatalog = SchemaCatalog(db, mapper)

    val transportProvider = KtorSseServerTransportProvider(mapper)

    val mcpServer = McpServer.sync(transportProvider)
        .serverInfo("riwonace-data-platform", "1.0.0")
        .capabilities(
            McpSchema.ServerCapabilities.builder()
                .tools(true)
                .resources(true, true)
                .build(),
        )
        .build()

    ToolRegistration.specifications(retrievalTools).forEach { mcpServer.addTool(it) }
    mcpServer.addResource(SchemaResourceRegistration.specification(schemaCatalog))

    embeddedServer(Netty, port = port) {
        install(SSE)
        routing {
            transportProvider.install(this)
        }
    }.start(wait = true)
}
