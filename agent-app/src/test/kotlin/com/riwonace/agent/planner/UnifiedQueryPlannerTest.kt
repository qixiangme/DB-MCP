package com.riwonace.agent.planner

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class UnifiedQueryPlannerTest {
    private val planner = UnifiedQueryPlanner()

    // ========== GRAPH 우선 케이스 ==========
    @Test
    fun `Client-A가 사용 중인 제품 목록은 GRAPH로 라우팅`() {
        val plan = planner.plan("Client-A가 사용 중인 제품 목록은?")
        assertIs<GraphQueryPlan>(plan)
        assertEquals("Client-A", plan.entity)
        assertEquals(GraphQueryPlan.Predicate.USES, plan.predicate)
        assertEquals(GraphQueryPlan.Direction.OUTGOING, plan.direction)
    }

    @Test
    fun `Product-C1을 사용하는 고객사는 GRAPH로 라우팅`() {
        val plan = planner.plan("Product-C1을 사용하는 고객사는 어디야?")
        assertIs<GraphQueryPlan>(plan)
        assertEquals("Product-C1", plan.entity)
        assertEquals(GraphQueryPlan.Predicate.USES, plan.predicate)
        assertEquals(GraphQueryPlan.Direction.INCOMING, plan.direction)
    }

    @Test
    fun `경영지원팀 팀장은 GRAPH로 라우팅`() {
        val plan = planner.plan("경영지원팀 팀장은 누구야?")
        assertIs<GraphQueryPlan>(plan)
        assertEquals("경영지원팀", plan.entity)
        assertEquals(GraphQueryPlan.Predicate.HEAD_OF, plan.predicate)
    }

    @Test
    fun `클라우드사업부 소속 직원들은 GRAPH로 라우팅`() {
        val plan = planner.plan("클라우드사업부 소속 직원들은 누구야?")
        assertIs<GraphQueryPlan>(plan)
        assertEquals("클라우드사업부", plan.entity)
        assertEquals(GraphQueryPlan.Predicate.BELONGS_TO, plan.predicate)
        assertEquals(GraphQueryPlan.Direction.INCOMING, plan.direction)
    }

    // ========== SQL 우선 케이스 ==========
    @Test
    fun `활성 계약 수는 SQL로 라우팅`() {
        val plan = planner.plan("현재 활성 상태인 계약 수는 몇 개야?")
        assertIs<SqlQueryPlan>(plan)
        assertEquals(SqlQueryPlan.Subject.CONTRACT, plan.subject)
        assertEquals(SqlQueryPlan.Aggregation.COUNT, plan.aggregation)
        assertEquals("active", plan.filter.status)
    }

    @Test
    fun `2025년 3분기 매출은 SQL로 라우팅`() {
        val plan = planner.plan("2025년 3분기 총 매출액은 얼마야?")
        assertIs<SqlQueryPlan>(plan)
        assertEquals(SqlQueryPlan.Subject.SALES, plan.subject)
        assertEquals(SqlQueryPlan.Aggregation.SUM, plan.aggregation)
        assertEquals("2025-Q3", plan.timeRange?.quarter)
    }

    @Test
    fun `부서별 평균 연봉은 SQL로 라우팅`() {
        val plan = planner.plan("부서별 평균 연봉을 알려줘")
        assertIs<SqlQueryPlan>(plan)
        assertEquals(SqlQueryPlan.Subject.EMPLOYEE, plan.subject)
        assertEquals(SqlQueryPlan.Aggregation.AVG, plan.aggregation)
        assertEquals(SqlQueryPlan.Dimension.DEPARTMENT, plan.groupBy)
    }

    @Test
    fun `가장 높은 평균 연봉 부서는 SQL로 라우팅`() {
        val plan = planner.plan("평균 연봉이 가장 높은 부서는 어디야?")
        assertIs<SqlQueryPlan>(plan)
        assertEquals(SqlQueryPlan.Subject.EMPLOYEE, plan.subject)
        assertEquals(SqlQueryPlan.Aggregation.AVG, plan.aggregation)
    }

    // ========== VECTOR 우선 케이스 ==========
    @Test
    fun `Product-C1 설치 방법은 VECTOR로 라우팅`() {
        val plan = planner.plan("Product-C1 설치 방법이 궁금해")
        assertIs<EvidencePlan>(plan)
        assertEquals(EvidencePlan.DocumentIntent.INSTALLATION, plan.intent)
        assertTrue(plan.keywords.contains("Product-C1"))
    }

    @Test
    fun `서버 장애 사례는 VECTOR로 라우팅`() {
        val plan = planner.plan("최근 서버 장애 사례와 원인을 알려줘")
        assertIs<EvidencePlan>(plan)
        assertEquals(EvidencePlan.DocumentIntent.TROUBLESHOOT, plan.intent)
    }

    @Test
    fun `백업 정책은 VECTOR로 라우팅`() {
        val plan = planner.plan("백업 정책은 어떻게 되어 있어?")
        assertIs<EvidencePlan>(plan)
        assertEquals(EvidencePlan.DocumentIntent.POLICY, plan.intent)
    }

    @Test
    fun `API 인증 방식은 VECTOR로 라우팅`() {
        val plan = planner.plan("API 인증 방식은 뭐야?")
        assertIs<EvidencePlan>(plan)
        assertEquals(EvidencePlan.DocumentIntent.POLICY, plan.intent)
    }

    // ========== confidence 점수 확인 ==========
    @Test
    fun `명확한 엔티티가 있으면 높은 confidence`() {
        val graphPlan = planner.plan("Client-A가 사용 중인 제품은?") as GraphQueryPlan
        assertTrue(graphPlan.confidence >= 0.8f)

        val sqlPlan = planner.plan("활성 계약 수는 몇 개야?") as SqlQueryPlan
        assertTrue(sqlPlan.confidence >= 0.8f)
    }
}
