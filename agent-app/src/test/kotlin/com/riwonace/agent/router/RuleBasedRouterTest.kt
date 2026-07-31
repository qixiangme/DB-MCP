package com.riwonace.agent.router

import org.junit.jupiter.api.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class RuleBasedRouterTest {

    private val router = RuleBasedRouter()

    @Test
    fun `집계 질문은 SQL로 라우팅된다`() {
        assertContains(router.route("플랫폼팀 직원의 평균 급여는 얼마야?"), Route.SQL)
        assertContains(router.route("가장 비싼 제품이 뭐야?"), Route.SQL)
    }

    @Test
    fun `개념 질문은 VECTOR로 라우팅된다`() {
        assertEquals(listOf(Route.VECTOR), router.route("MCP가 뭔가요? 설명해줘"))
    }

    @Test
    fun `관계 질문은 GRAPH로 라우팅된다`() {
        assertContains(router.route("air는 누가 개발했어?"), Route.GRAPH)
        assertContains(router.route("MCP와 RAG는 무슨 사이야?"), Route.GRAPH)
    }

    @Test
    fun `복합 질문은 여러 라우트로 병렬 처리된다 (MCP Parallel)`() {
        val routes = router.route("pgvector 개념을 설명하고 관련된 제품 목록도 알려줘")
        assertContains(routes, Route.SQL)
        assertContains(routes, Route.VECTOR)
    }

    @Test
    fun `어떤 규칙에도 안 걸리면 VECTOR가 기본값이다`() {
        assertEquals(listOf(Route.VECTOR), router.route("안녕하세요"))
    }
}
