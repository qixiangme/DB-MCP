package com.riwonace.agentktor.llm

import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/**
 * Replaces Spring AI's ChatClient.prompt().system(...).user(...).call().content() call
 * sites scattered across AgentServiceV2/AnswerabilityGate/route fallbacks in the
 * baseline with a minimal Ollama /api/chat client. Same model config as
 * application.yml: temperature 0.0, num-ctx 4096, max-tokens 512.
 */
class OllamaChatClient(
    private val baseUrl: String,
    private val model: String,
    private val mapper: ObjectMapper,
    private val temperature: Double = 0.0,
    private val numCtx: Int = 4096,
    private val maxTokens: Int = 512,
) {
    private val client = HttpClient.newHttpClient()

    fun complete(system: String, user: String): String {
        val body = mapper.writeValueAsString(
            mapOf(
                "model" to model,
                "messages" to listOf(
                    mapOf("role" to "system", "content" to system),
                    mapOf("role" to "user", "content" to user),
                ),
                "stream" to false,
                "options" to mapOf(
                    "temperature" to temperature,
                    "num_ctx" to numCtx,
                    "num_predict" to maxTokens,
                ),
            ),
        )
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/api/chat"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        check(response.statusCode() == 200) { "Ollama chat request failed: ${response.statusCode()}" }

        val parsed: Map<String, Any?> = mapper.readValue(
            response.body(),
            mapper.typeFactory.constructMapType(Map::class.java, String::class.java, Any::class.java),
        )
        @Suppress("UNCHECKED_CAST")
        val message = parsed["message"] as? Map<String, Any?>
        return message?.get("content") as? String ?: ""
    }

    /** Ports ModelWarmup.kt: force the model to load once at startup. */
    fun warmup() {
        try {
            val body = mapper.writeValueAsString(
                mapOf(
                    "model" to model,
                    "messages" to listOf(mapOf("role" to "user", "content" to "hi")),
                    "stream" to false,
                    "options" to mapOf("num_predict" to 1),
                ),
            )
            val request = HttpRequest.newBuilder()
                .uri(URI.create("$baseUrl/api/chat"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build()
            client.send(request, HttpResponse.BodyHandlers.discarding())
        } catch (_: Exception) {
            // best-effort, mirrors ModelWarmup.kt swallowing failures
        }
    }
}
