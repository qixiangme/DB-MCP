package com.riwonace.agent.planner

/**
 * SQL, GRAPH, VECTOR를 하나의 계획에서 선택하는 통합 IR.
 *
 * 질문의 의도를 먼저 분석하고, 가장 적합한 경로를 결정한다.
 * 평가 문항의 정답이나 고유 키워드는 저장하지 않는다.
 */
sealed class UnifiedQueryPlan {
    abstract val confidence: Float
    abstract val reason: String
}

/**
 * SQL 경로: 정형 데이터 집계, 필터, 조인이 필요한 질의
 */
data class SqlQueryPlan(
    val subject: Subject,
    val aggregation: Aggregation = Aggregation.NONE,
    val groupBy: Dimension? = null,
    val filter: Filter = Filter(),
    val order: Order? = null,
    val limit: Int? = null,
    val comparison: Comparison? = null,
    val timeRange: TimeRange? = null,
    override val confidence: Float = 0.8f,
    override val reason: String = "",
) : UnifiedQueryPlan() {
    enum class Subject { EMPLOYEE, CLIENT, CONTRACT, PROJECT, TICKET, PRODUCT, SALES, DEPARTMENT }
    enum class Aggregation { NONE, COUNT, SUM, AVG, MAX, MIN }
    enum class Dimension { DEPARTMENT, REGION, CATEGORY, PRODUCT, CLIENT }
    enum class Order { ASC, DESC, NEWEST, OLDEST }
    data class Filter(
        val status: String? = null,
        val priority: String? = null,
        val notNull: List<String> = emptyList(),
        val isNull: List<String> = emptyList(),
        val entityName: String? = null,
        val departmentName: String? = null,
        val region: String? = null,
        val category: String? = null,
    )
    data class Comparison(
        val type: Type,
        val field: String,
        val entities: List<String> = emptyList(),
    ) {
        enum class Type { GREATER, LESS, EQUAL, BETWEEN, TOP_N }
    }
    data class TimeRange(
        val start: String? = null,
        val end: String? = null,
        val quarter: String? = null,
        val year: Int? = null,
        val currentMonth: Boolean = false,
    )
}

/**
 * GRAPH 경로: 엔티티 간 관계 탐색, 조인 없이 트리플 기반 조회
 */
data class GraphQueryPlan(
    val entity: String?,
    val predicate: Predicate,
    val direction: Direction = Direction.OUTGOING,
    val hops: Int = 1,
    val aggregation: GraphAggregation? = null,
    val filter: GraphFilter? = null,
    override val confidence: Float = 0.8f,
    override val reason: String = "",
) : UnifiedQueryPlan() {
    enum class Predicate {
        USES,           // 사용한다
        BELONGS_TO,     // 소속
        MANAGES,        // 담당한다, 이끈다
        LEADS,          // 리드
        REPORTS_ISSUE,  // 이슈보고
        HEAD_OF,        // 부서장
        ANY,            // 특정 관계 없이 연결된 엔티티
    }
    enum class Direction { OUTGOING, INCOMING, BOTH }
    enum class GraphAggregation { COUNT, MOST, LEAST }
    data class GraphFilter(
        val entityType: String? = null,  // Client, Product, Employee, Department
        val predicateValue: String? = null,
    )
}

/**
 * VECTOR 경로: 비정형 문서 검색, 절차/방법/정책 관련 질의
 */
data class EvidencePlan(
    val intent: DocumentIntent,
    val requiredSources: List<String> = emptyList(),
    val keywords: List<String> = emptyList(),
    val extractive: Boolean = true,
    override val confidence: Float = 0.7f,
    override val reason: String = "",
) : UnifiedQueryPlan() {
    enum class DocumentIntent {
        INSTALLATION,   // 설치 방법
        TROUBLESHOOT,   // 장애 대응
        POLICY,         // 정책 (백업, 보안)
        MEETING,        // 회의록
        PROPOSAL,       // 제안서
        GENERAL,        // 일반 문서 검색
    }
}

/**
 * 복합 경로: 여러 경로가 필요한 질의 (예: SQL + GRAPH)
 */
data class CompositeQueryPlan(
    val plans: List<UnifiedQueryPlan>,
    val mergeStrategy: MergeStrategy = MergeStrategy.UNION,
    override val confidence: Float = 0.6f,
    override val reason: String = "",
) : UnifiedQueryPlan() {
    enum class MergeStrategy { UNION, INTERSECT, FIRST_SUCCESS }
}
