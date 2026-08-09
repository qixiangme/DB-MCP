package com.riwonace.agent.api

import com.riwonace.agent.mcp.McpGateway
import com.riwonace.agent.service.AgentAnswer
import com.riwonace.agent.service.AgentService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.slf4j.LoggerFactory
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * POST `/api/chat` 요청 본문.
 *
 * 보안 강화:
 * - 빈 문자열 거부 (@NotBlank)
 * - 최대 길이 제한으로 DoS 방지 (@Size)
 */
data class ChatRequest(
    @field:NotBlank(message = "질문은 공백일 수 없습니다.")
    @field:Size(min = 2, max = 2000, message = "질문은 2자 이상 2000자 이하여야 합니다.")
    val question: String,
)

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
    private val log = LoggerFactory.getLogger(javaClass)

    /** 질문의 답변과 선택한 라우트, 도구 호출, 출처 및 전체 지연 시간을 반환한다. */
    @PostMapping("/chat")
    fun chat(@Valid @RequestBody request: ChatRequest): AgentAnswer {
        val question = sanitizeInput(request.question)
        return agentService.chat(question)
    }

    /** MCP 연결 상태를 진단할 수 있도록 서버가 노출한 도구 이름을 반환한다. */
    @GetMapping("/tools")
    fun tools(): Map<String, Any> =
        mapOf("mcpTools" to gateway.listToolNames())

    /**
     * 입력값을 정제한다.
     * - 앞뒤 공백 제거
     * - 제어 문자 제거
     */
    private fun sanitizeInput(input: String): String {
        return input.trim()
            .replace(Regex("[\\x00-\\x1F\\x7F]"), "") // 제어 문자 제거
    }
}
