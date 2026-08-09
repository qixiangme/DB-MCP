package com.riwonace.mcp.tools

import com.fasterxml.jackson.databind.ObjectMapper

/** MCP 도구 응답의 JSON 문법과 출력 예산을 한 경계에서 보장한다. */
internal class ToolResponseEncoder(
    private val mapper: ObjectMapper,
    private val maxOutputChars: Int,
) {
    init {
        require(maxOutputChars >= MIN_OUTPUT_CHARS) {
            "maxOutputChars는 구조화된 오류를 담을 수 있도록 $MIN_OUTPUT_CHARS 이상이어야 합니다."
        }
    }

    fun encode(value: Any): String {
        val json = mapper.writeValueAsString(value)
        if (json.length <= maxOutputChars) return json

        return mapper.writeValueAsString(
            mapOf(
                "error" to "tool_output_too_large",
                "truncated" to true,
                "originalChars" to json.length,
                "maxOutputChars" to maxOutputChars,
            ),
        )
    }

    fun encodeError(error: Exception): String {
        val encoded = mapper.writeValueAsString(
            mapOf(
                "error" to (error.message ?: error.javaClass.simpleName).take(MAX_ERROR_CHARS),
                "truncated" to false,
            ),
        )
        if (encoded.length <= maxOutputChars) return encoded

        return mapper.writeValueAsString(
            mapOf(
                "error" to error.javaClass.simpleName,
                "truncated" to true,
            ),
        )
    }

    private companion object {
        const val MIN_OUTPUT_CHARS = 128
        const val MAX_ERROR_CHARS = 500
    }
}
