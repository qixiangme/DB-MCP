package com.riwonace.agent.router

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SemanticAiRouteFallbackTest {

    @Test
    fun `정확한 라벨과 주변 공백만 허용한다`() {
        assertEquals(Route.SQL, parseExactRoute(" SQL\n"))
        assertEquals(Route.VECTOR, parseExactRoute("vector"))
        assertEquals(Route.GRAPH, parseExactRoute("GRAPH"))
    }

    @Test
    fun `설명이나 여러 라벨이 섞인 출력은 거부한다`() {
        assertNull(parseExactRoute("분류: SQL"))
        assertNull(parseExactRoute("SQL 또는 GRAPH"))
        assertNull(parseExactRoute("벡터"))
        assertNull(parseExactRoute(""))
    }
}
