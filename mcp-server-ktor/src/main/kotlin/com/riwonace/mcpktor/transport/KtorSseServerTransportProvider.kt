package com.riwonace.mcpktor.transport

import com.fasterxml.jackson.databind.ObjectMapper
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.sse.sse
import io.ktor.sse.ServerSentEvent
import io.modelcontextprotocol.spec.McpSchema
import io.modelcontextprotocol.spec.McpServerSession
import io.modelcontextprotocol.spec.McpServerTransport
import io.modelcontextprotocol.spec.McpServerTransportProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.reactor.awaitSingleOrNull
import kotlinx.coroutines.reactor.mono
import reactor.core.publisher.Mono
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Ktor implementation of [McpServerTransportProvider], the one piece the official
 * Kotlin MCP SDK (`io.modelcontextprotocol.sdk:mcp`) does not ship a ready adapter for
 * (it only ships a Servlet-based SSE provider, wired for Spring MVC). This ports the
 * same wire protocol -- a GET SSE stream that first emits an `endpoint` event naming a
 * per-session POST URL, followed by `message` events carrying server->client
 * JSON-RPC traffic, with client->server traffic delivered via POST to that URL -- onto
 * Ktor routing + `ktor-server-sse`, so the rest of the SDK (McpServer, tool/resource
 * registration, session/protocol handling) runs completely unmodified.
 *
 * mirrors: mcp-server's Spring AI `spring-ai-starter-mcp-server-webmvc` auto-config,
 * which wires the SDK's `HttpServletSseServerTransportProvider` the same way.
 */
class KtorSseServerTransportProvider(
    private val objectMapper: ObjectMapper,
    private val messageEndpoint: String = "/mcp/message",
) : McpServerTransportProvider {

    private var sessionFactory: McpServerSession.Factory? = null
    private val sessions = ConcurrentHashMap<String, SessionHandle>()

    private class SessionHandle(
        val session: McpServerSession,
        val outbound: Channel<String>,
    )

    override fun setSessionFactory(factory: McpServerSession.Factory) {
        sessionFactory = factory
    }

    override fun notifyClients(method: String, params: Any?): Mono<Void> = mono {
        for (handle in sessions.values) {
            handle.session.sendNotification(method, params).awaitVoid()
        }
    }.then()

    override fun closeGracefully(): Mono<Void> = mono {
        for (handle in sessions.values) {
            handle.session.closeGracefully().awaitVoid()
        }
        sessions.clear()
    }.then()

    /** Registers the two Ktor routes this transport needs: SSE stream and message POST. */
    fun install(routing: Routing) {
        routing.apply {
            sse("/sse") {
                val sessionId = UUID.randomUUID().toString()
                val outbound = Channel<String>(Channel.UNLIMITED)
                val transport = ChannelBackedTransport(outbound, objectMapper)
                val session = sessionFactory?.create(transport)
                    ?: error("MCP session factory not initialized")
                sessions[sessionId] = SessionHandle(session, outbound)

                try {
                    send(ServerSentEvent(event = "endpoint", data = "$messageEndpoint?sessionId=$sessionId"))
                    outbound.receiveAsFlow().collect { payload ->
                        send(ServerSentEvent(event = "message", data = payload))
                    }
                } finally {
                    sessions.remove(sessionId)
                    outbound.close()
                }
            }

            post(messageEndpoint) {
                val sessionId = call.request.queryParameters["sessionId"]
                    ?: return@post call.respond(io.ktor.http.HttpStatusCode.BadRequest, "missing sessionId")
                val handle = sessions[sessionId]
                    ?: return@post call.respond(io.ktor.http.HttpStatusCode.NotFound, "unknown session")

                val body = call.receiveText()
                val message = McpSchema.deserializeJsonRpcMessage(objectMapper, body)
                handle.session.handle(message).awaitVoid()
                call.respond(io.ktor.http.HttpStatusCode.OK)
            }
        }
    }

    /** [McpServerTransport] that pushes outgoing JSON-RPC frames onto this session's SSE channel. */
    private class ChannelBackedTransport(
        private val outbound: Channel<String>,
        private val objectMapper: ObjectMapper,
    ) : McpServerTransport {
        override fun sendMessage(message: McpSchema.JSONRPCMessage): Mono<Void> = mono {
            val json = objectMapper.writeValueAsString(message)
            outbound.trySendBlocking(json)
        }.then()

        override fun <T> unmarshalFrom(data: Any, typeRef: com.fasterxml.jackson.core.type.TypeReference<T>): T =
            objectMapper.convertValue(data, typeRef)

        override fun closeGracefully(): Mono<Void> = mono { outbound.close() }.then()
    }
}

/** Awaits a reactor Mono<Void> from within a Kotlin coroutine. */
private suspend fun Mono<Void>.awaitVoid() {
    this.awaitSingleOrNull()
}
