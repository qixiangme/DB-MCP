package com.riwonace.mcp.tools

import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ToolResponseEncoderTest {
    private val mapper = ObjectMapper()

    @Test
    fun `출력 예산 이내 응답은 기존 JSON 구조를 유지한다`() {
        val encoder = ToolResponseEncoder(mapper, 200)

        val encoded = encoder.encode(listOf(mapOf("source" to "guide", "text" to "content")))
        val parsed = mapper.readTree(encoded)

        assertTrue(parsed.isArray)
        assertEquals("guide", parsed[0]["source"].asText())
    }

    @Test
    fun `출력 예산 초과 응답은 제한 정보를 담은 유효한 JSON이다`() {
        val encoder = ToolResponseEncoder(mapper, 200)

        val encoded = encoder.encode(mapOf("rows" to listOf("x".repeat(500))))
        val parsed = mapper.readTree(encoded)

        assertTrue(encoded.length <= 200)
        assertEquals("tool_output_too_large", parsed["error"].asText())
        assertTrue(parsed["truncated"].asBoolean())
        assertEquals(200, parsed["maxOutputChars"].asInt())
        assertTrue(parsed["originalChars"].asInt() > 200)
    }

    @Test
    fun `예외 응답은 메시지를 제한하고 유효한 JSON을 유지한다`() {
        val encoder = ToolResponseEncoder(mapper, 200)

        val encoded = encoder.encodeError(IllegalStateException("x".repeat(1_000)))
        val parsed = mapper.readTree(encoded)

        assertTrue(encoded.length <= 200)
        assertEquals("IllegalStateException", parsed["error"].asText())
        assertTrue(parsed["truncated"].asBoolean())
    }
}
