package com.riwonace.agent.api

import com.riwonace.agent.mcp.McpGateway
import com.riwonace.agent.service.AgentAnswer
import com.riwonace.agent.service.AgentService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** POST `/api/chat` 요청 본문. */
data class ChatRequest(val question: String)

/**
 * 에이전트 오케스트레이션을 HTTP API로 노출하는 어댑터.
 *
 * 답변 생성은 [AgentService]에 위임하고, MCP 연결 진단만 [McpGateway]에서 직접 조회한다.
 */
@RestController
@RequestMapping("/api")
class ChatController(
    private val agentService: AgentService,
    private val gateway: McpGateway,
) {

    /** 질문의 답변과 선택한 라우트, 도구 호출, 출처 및 전체 지연 시간을 반환한다. */
    @PostMapping("/chat")
    fun chat(@RequestBody request: ChatRequest): AgentAnswer =
        agentService.chat(request.question)

    /** MCP 연결 상태를 진단할 수 있도록 서버가 노출한 도구 이름을 반환한다. */
    @GetMapping("/tools")
    fun tools(): Map<String, Any> =
        mapOf("mcpTools" to gateway.listToolNames())
}
