package com.riwonace.agent.sql

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DeterministicSqlPlannerTest {
    private val planner = DeterministicSqlPlanner()

    @Test
    fun `제품의 단순 속성과 활성 계약 집계를 컴파일한다`() {
        assertEquals(
            "SELECT price_monthly FROM products WHERE name = 'Product-C1'",
            planner.plan("Product-C1의 월 가격 알려줘"),
        )
        assertContains(planner.plan("Product-S1 활성 계약 수 알려줘")!!, "count(*)")
        assertContains(planner.plan("Product-D1 활성 계약 금액 합계 알려줘")!!, "sum(c.amount)")
    }

    @Test
    fun `부서 평균과 고객 매출은 올바른 외래키 조인을 사용한다`() {
        assertContains(planner.plan("기술지원팀 평균 급여")!!, "e.dept_id = d.id")
        assertContains(planner.plan("Client-Q 총 매출")!!, "s.client_id = c.id")
    }

    @Test
    fun `수치 조건으로 제품을 찾는 모호한 복합 질문을 컴파일한다`() {
        assertContains(
            planner.plan("월 120인 cloud 제품 중 CPU 기준을 만족하는 것은?")!!,
            "price_monthly = 120",
        )
        assertContains(
            planner.plan("활성 계약 금액이 22,000인 data 제품")!!,
            "HAVING sum(c.amount) = 22000",
        )
        assertContains(
            planner.plan("활성 계약이 6건인 security 제품")!!,
            "HAVING count(*) = 6",
        )
    }

    @Test
    fun `고신뢰 패턴 밖 질문은 LLM 폴백을 위해 null을 반환한다`() {
        assertNull(planner.plan("최근 복잡한 프로젝트 상태를 분석해줘"))
    }
}
