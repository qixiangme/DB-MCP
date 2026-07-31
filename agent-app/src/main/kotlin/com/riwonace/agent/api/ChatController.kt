package com.riwonace.agent.api

import com.riwonace.agent.mcp.McpGateway
import com.riwonace.agent.service.AgentAnswer
import com.riwonace.agent.service.AgentService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class ChatRequest(val question: String)

@RestController
@RequestMapping("/api")
class ChatController(
    private val agentService: AgentService,
    private val gateway: McpGateway,
) {

    @PostMapping("/chat")
    fun chat(@RequestBody request: ChatRequest): AgentAnswer =
        agentService.chat(request.question)

    /** MCP 연결 상태와 서버가 노출한 도구 목록 확인용 */
    @GetMapping("/tools")
    fun tools(): Map<String, Any> =
        mapOf("mcpTools" to gateway.listToolNames())
}
