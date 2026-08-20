package com.riwonace.mcpktor.tools

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Ktor-port equivalent of RetrievalToolsContractTest: since this SDK has no @Tool
 * annotation to reflect over, the contract is verified directly against the names
 * embedded in the registered McpSchema.Tool specifications.
 */
class ToolRegistrationContractTest {
    @Test
    fun `공개 실행 도구는 과제에서 요구한 세 종류뿐이다`() {
        assertEquals(setOf("vector_search", "run_sql", "kg_search"), ToolRegistration.TOOL_NAMES)
    }
}
