package com.riwonace.mcpktor.embedding

import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/**
 * Calls Ollama's /api/embeddings, replacing Spring AI's OllamaEmbeddingModel (wired via
 * spring.ai.ollama.embedding.options.model: nomic-embed-text in the baseline's
 * application.yml). Same model, same endpoint, same request shape.
 */
class OllamaEmbedder(
    private val baseUrl: String,
    private val model: String,
    private val mapper: ObjectMapper,
) {
    private val client = HttpClient.newHttpClient()

    fun embed(text: String): List<Double> {
        val body = mapper.writeValueAsString(mapOf("model" to model, "prompt" to text))
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/api/embeddings"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        check(response.statusCode() == 200) { "Ollama embeddings request failed: ${response.statusCode()}" }
        val parsed: Map<String, Any?> = mapper.readValue(
            response.body(),
            mapper.typeFactory.constructMapType(Map::class.java, String::class.java, Any::class.java),
        )
        @Suppress("UNCHECKED_CAST")
        return (parsed["embedding"] as List<Number>).map { it.toDouble() }
    }
}
