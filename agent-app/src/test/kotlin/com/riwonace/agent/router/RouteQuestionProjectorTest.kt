package com.riwonace.agent.router

import kotlin.test.Test
import kotlin.test.assertEquals

class RouteQuestionProjectorTest {
    private val projector = RouteQuestionProjector()

    @Test
    fun `가격과 설치 요구를 각 도구 질문으로 분리한다`() {
        val question = "Product-C1의 월 가격과 설치에 필요한 컨테이너 도구를 함께 알려줘."
        assertEquals("Product-C1의 월 가격 알려줘", projector.project(question, Route.SQL))
        assertEquals("Product-C1 설치에 필요한 컨테이너 도구를 알려줘", projector.project(question, Route.VECTOR))
    }

    @Test
    fun `그래프 요구 뒤의 SQL 요구에도 엔티티를 보존한다`() {
        val question = "Product-C1 도입 제안 대상과 현재 실제 사용 고객을 구분하고 월 가격도 알려줘."
        assertEquals("Product-C1 월 가격도 알려줘", projector.project(question, Route.SQL))
        assertEquals("Product-C1 현재 실제 사용 고객을 알려줘", projector.project(question, Route.GRAPH))
    }

    @Test
    fun `분해 근거가 없으면 원문을 보존한다`() {
        val question = "월 120인 cloud 제품 중 CPU 62%에서 늘어나며 Client-A가 쓰는 것은 무엇이야?"
        assertEquals(question, projector.project(question, Route.SQL))
    }
}
