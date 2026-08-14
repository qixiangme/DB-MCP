package com.riwonace.agent.planner

import org.springframework.stereotype.Component

/**
 * 질문을 분석하여 SQL, GRAPH, VECTOR 중 최적 경로를 선택하는 통합 플래너.
 *
 * 핵심 원칙:
 * 1. 관계 탐색(누가 X를 사용하는가, X의 담당자는) → GRAPH 우선
 * 2. 집계/필터/정렬(몇 개, 총합, 평균, 가장 많은) → SQL 우선
 * 3. 절차/방법/정책(설치 방법, 장애 대응, 백업 정책) → VECTOR 우선
 * 4. 모호한 경우 → confidence 점수로 판단하거나 복합 경로
 */
@Component
class UnifiedQueryPlanner {

    fun plan(question: String): UnifiedQueryPlan {
        val q = question.lowercase()

        // 1. VECTOR 우선 패턴 (문서 기반 질의)
        if (isDocumentQuery(q)) {
            return planEvidence(question, q)
        }

        // 2. GRAPH 우선 패턴 (관계 탐색 질의)
        if (isRelationQuery(q)) {
            return planGraph(question, q)
        }

        // 3. SQL 우선 패턴 (정형 데이터 질의)
        if (isStructuredQuery(q)) {
            return planSql(question, q)
        }

        // 4. 복합/모호한 경우
        val graphPlan = tryPlanGraph(question, q)
        val sqlPlan = tryPlanSql(question, q)
        val evidencePlan = tryPlanEvidence(question, q)

        val candidates = listOfNotNull(graphPlan, sqlPlan, evidencePlan)
            .sortedByDescending { it.confidence }

        return when {
            candidates.isEmpty() -> EvidencePlan(
                intent = EvidencePlan.DocumentIntent.GENERAL,
                confidence = 0.5f,
                reason = "패턴 매칭 실패, VECTOR 폴백"
            )
            candidates.size == 1 -> candidates.first()
            candidates[0].confidence - candidates[1].confidence < 0.2f ->
                CompositeQueryPlan(
                    plans = candidates.take(2),
                    mergeStrategy = CompositeQueryPlan.MergeStrategy.FIRST_SUCCESS,
                    confidence = candidates[0].confidence,
                    reason = "복수 경로 후보"
                )
            else -> candidates.first()
        }
    }

    // ========== VECTOR 패턴 ==========
    private fun isDocumentQuery(q: String): Boolean {
        // 문서 의도가 명확한 키워드 (엔티티가 있어도 VECTOR 우선)
        val strongDocKeywords = listOf(
            "방법", "어떻게", "절차", "가이드", "설치", "설정",
            "장애 사례", "장애 대응", "장애 보고", "오류", "에러",
            "정책", "백업 정책", "보안 정책", "인증 방식"
        )
        // 일반 문서 키워드 (엔티티가 없을 때만 VECTOR)
        val weakDocKeywords = listOf(
            "장애", "회의", "미팅", "논의", "제안서", "마이그레이션"
        )

        val hasStrongDoc = strongDocKeywords.any { it in q }
        val hasWeakDoc = weakDocKeywords.any { it in q }

        return (hasStrongDoc || (hasWeakDoc && !hasExplicitEntity(q))) &&
            !isAggregateQuery(q)
    }

    private fun planEvidence(question: String, q: String): EvidencePlan {
        val intent = when {
            "설치" in q || "설정" in q -> EvidencePlan.DocumentIntent.INSTALLATION
            "장애" in q || "오류" in q || "에러" in q -> EvidencePlan.DocumentIntent.TROUBLESHOOT
            "백업" in q || "보안" in q || "정책" in q || "인증" in q -> EvidencePlan.DocumentIntent.POLICY
            "회의" in q || "미팅" in q || "논의" in q -> EvidencePlan.DocumentIntent.MEETING
            "제안서" in q || "마이그레이션" in q -> EvidencePlan.DocumentIntent.PROPOSAL
            else -> EvidencePlan.DocumentIntent.GENERAL
        }
        val keywords = extractKeywords(question)
        return EvidencePlan(
            intent = intent,
            keywords = keywords,
            extractive = intent != EvidencePlan.DocumentIntent.INSTALLATION,
            confidence = 0.85f,
            reason = "문서 검색 패턴"
        )
    }

    private fun tryPlanEvidence(question: String, q: String): EvidencePlan? {
        if (isDocumentQuery(q)) return planEvidence(question, q)
        return null
    }

    // ========== GRAPH 패턴 ==========
    private fun isRelationQuery(q: String): Boolean {
        val relationKeywords = listOf(
            "사용 중인", "사용하는", "사용중인",
            "담당", "이끄는", "리드", "맡은",
            "소속", "팀장", "부서장",
            "관련", "연결된"
        )
        val entityPattern = hasExplicitEntity(q)
        return relationKeywords.any { it in q } && entityPattern
    }

    private fun hasExplicitEntity(q: String): Boolean {
        return PRODUCT.containsMatchIn(q) || CLIENT.containsMatchIn(q) ||
               DEPARTMENT.containsMatchIn(q)
    }

    private fun planGraph(question: String, q: String): GraphQueryPlan {
        val product = PRODUCT.find(question)?.value
        val client = CLIENT.find(question)?.value
        val department = DEPARTMENT.find(question)?.value

        val entity = product ?: client ?: department

        val (predicate, direction) = when {
            // "X가 사용 중인 제품" → entity=X, predicate=USES, direction=OUTGOING
            "사용 중인" in q || "사용중인" in q ->
                GraphQueryPlan.Predicate.USES to GraphQueryPlan.Direction.OUTGOING
            // "X를 사용하는 고객" → entity=X, predicate=USES, direction=INCOMING
            "사용하는" in q && "고객" in q ->
                GraphQueryPlan.Predicate.USES to GraphQueryPlan.Direction.INCOMING
            // "X 팀장", "X 부서장"
            "팀장" in q || "부서장" in q ->
                GraphQueryPlan.Predicate.HEAD_OF to GraphQueryPlan.Direction.OUTGOING
            // "X 소속 직원"
            "소속" in q && "직원" in q ->
                GraphQueryPlan.Predicate.BELONGS_TO to GraphQueryPlan.Direction.INCOMING
            // "X 담당 엔지니어"
            "담당" in q ->
                GraphQueryPlan.Predicate.MANAGES to GraphQueryPlan.Direction.INCOMING
            // "X 이끄는 프로젝트"
            "이끄" in q || "리드" in q ->
                GraphQueryPlan.Predicate.LEADS to GraphQueryPlan.Direction.OUTGOING
            // "X 관련 이슈"
            "이슈" in q ->
                GraphQueryPlan.Predicate.REPORTS_ISSUE to GraphQueryPlan.Direction.INCOMING
            else ->
                GraphQueryPlan.Predicate.ANY to GraphQueryPlan.Direction.BOTH
        }

        val aggregation = when {
            "가장 많은" in q || "최다" in q -> GraphQueryPlan.GraphAggregation.MOST
            "몇" in q && !isAggregateQuery(q) -> GraphQueryPlan.GraphAggregation.COUNT
            else -> null
        }

        return GraphQueryPlan(
            entity = entity,
            predicate = predicate,
            direction = direction,
            hops = if ("관련" in q && "프로젝트" in q) 2 else 1,
            aggregation = aggregation,
            confidence = if (entity != null) 0.9f else 0.7f,
            reason = "관계 탐색 패턴"
        )
    }

    private fun tryPlanGraph(question: String, q: String): GraphQueryPlan? {
        if (isRelationQuery(q)) return planGraph(question, q)
        if (hasExplicitEntity(q) && !isAggregateQuery(q)) {
            return planGraph(question, q).copy(confidence = 0.6f)
        }
        return null
    }

    // ========== SQL 패턴 ==========
    private fun isStructuredQuery(q: String): Boolean {
        return isAggregateQuery(q) || isFilterQuery(q) || isComparisonQuery(q)
    }

    private fun isAggregateQuery(q: String): Boolean {
        val aggregateKeywords = listOf(
            "몇", "개수", "수", "총", "합계", "평균", "최고", "최저",
            "가장 높은", "가장 낮은", "가장 많은"
        )
        return aggregateKeywords.any { it in q }
    }

    private fun isFilterQuery(q: String): Boolean {
        val filterKeywords = listOf(
            "활성", "진행 중", "미해결", "해결된", "등록된"
        )
        return filterKeywords.any { it in q }
    }

    private fun isComparisonQuery(q: String): Boolean {
        val comparisonKeywords = listOf(
            "비교", "보다 높은", "보다 낮은", "이상", "이하", "초과", "미만"
        )
        return comparisonKeywords.any { it in q }
    }

    private fun planSql(question: String, q: String): SqlQueryPlan {
        val subject = detectSubject(q)
        val aggregation = detectAggregation(q)
        val groupBy = detectGroupBy(q)
        val filter = detectFilter(question, q)
        val order = detectOrder(q)
        val limit = detectLimit(question)
        val comparison = detectComparison(q)
        val timeRange = detectTimeRange(question, q)

        return SqlQueryPlan(
            subject = subject,
            aggregation = aggregation,
            groupBy = groupBy,
            filter = filter,
            order = order,
            limit = limit,
            comparison = comparison,
            timeRange = timeRange,
            confidence = 0.85f,
            reason = "정형 데이터 질의"
        )
    }

    private fun tryPlanSql(question: String, q: String): SqlQueryPlan? {
        if (isStructuredQuery(q)) return planSql(question, q)
        return null
    }

    private fun detectSubject(q: String): SqlQueryPlan.Subject = when {
        "직원" in q || "연봉" in q || "급여" in q -> SqlQueryPlan.Subject.EMPLOYEE
        "고객사" in q || "고객" in q -> SqlQueryPlan.Subject.CLIENT
        "계약" in q -> SqlQueryPlan.Subject.CONTRACT
        "프로젝트" in q -> SqlQueryPlan.Subject.PROJECT
        "티켓" in q || "이슈" in q && !isDocumentQuery(q) -> SqlQueryPlan.Subject.TICKET
        "제품" in q || "카테고리" in q -> SqlQueryPlan.Subject.PRODUCT
        "매출" in q || "판매" in q -> SqlQueryPlan.Subject.SALES
        "부서" in q -> SqlQueryPlan.Subject.DEPARTMENT
        else -> SqlQueryPlan.Subject.CLIENT
    }

    private fun detectAggregation(q: String): SqlQueryPlan.Aggregation = when {
        "평균" in q -> SqlQueryPlan.Aggregation.AVG
        "총" in q || "합계" in q || "총액" in q -> SqlQueryPlan.Aggregation.SUM
        "최고" in q || "가장 높은" in q || "최대" in q -> SqlQueryPlan.Aggregation.MAX
        "최저" in q || "가장 낮은" in q || "최소" in q -> SqlQueryPlan.Aggregation.MIN
        "몇" in q || "개수" in q || "수" in q -> SqlQueryPlan.Aggregation.COUNT
        else -> SqlQueryPlan.Aggregation.NONE
    }

    private fun detectGroupBy(q: String): SqlQueryPlan.Dimension? = when {
        "부서별" in q -> SqlQueryPlan.Dimension.DEPARTMENT
        "지역별" in q -> SqlQueryPlan.Dimension.REGION
        "카테고리별" in q || "제품별" in q -> SqlQueryPlan.Dimension.CATEGORY
        "고객별" in q || "고객사별" in q -> SqlQueryPlan.Dimension.CLIENT
        else -> null
    }

    private fun detectFilter(question: String, q: String): SqlQueryPlan.Filter {
        val department = DEPARTMENT.find(question)?.value
        val region = REGION.find(question)?.value
        val category = CATEGORY.find(question)?.value

        return SqlQueryPlan.Filter(
            status = when {
                "활성" in q || "진행 중" in q -> "active"
                "비활성" in q || "종료" in q -> "inactive"
                "미해결" in q || "열린" in q -> "open"
                "해결된" in q -> "resolved"
                else -> null
            },
            priority = when {
                "critical" in q -> "critical"
                "high" in q || "높은 우선순위" in q -> "high"
                else -> null
            },
            isNull = if ("담당자가 없는" in q || "미지정" in q) listOf("assignee_id") else emptyList(),
            departmentName = department,
            region = region,
            category = category,
        )
    }

    private fun detectOrder(q: String): SqlQueryPlan.Order? = when {
        "큰 순서" in q || "높은 순서" in q || "내림차순" in q -> SqlQueryPlan.Order.DESC
        "작은 순서" in q || "낮은 순서" in q || "오름차순" in q -> SqlQueryPlan.Order.ASC
        "최근" in q || "최신" in q -> SqlQueryPlan.Order.NEWEST
        "오래된" in q -> SqlQueryPlan.Order.OLDEST
        else -> null
    }

    private fun detectLimit(question: String): Int? {
        val match = LIMIT.find(question) ?: return null
        return match.groupValues[1].toIntOrNull()?.coerceIn(1, 50)
    }

    private fun detectComparison(q: String): SqlQueryPlan.Comparison? {
        if ("비교" !in q && "보다" !in q) return null
        val type = when {
            "보다 높은" in q || "초과" in q || "이상" in q -> SqlQueryPlan.Comparison.Type.GREATER
            "보다 낮은" in q || "미만" in q || "이하" in q -> SqlQueryPlan.Comparison.Type.LESS
            else -> return null
        }
        return SqlQueryPlan.Comparison(type = type, field = "amount")
    }

    private fun detectTimeRange(question: String, q: String): SqlQueryPlan.TimeRange? {
        val quarterMatch = QUARTER.find(question)
        val yearMatch = YEAR.find(question)

        if (quarterMatch == null && yearMatch == null && "이번 달" !in q) return null

        return SqlQueryPlan.TimeRange(
            quarter = quarterMatch?.let { "${it.groupValues[1]}-Q${it.groupValues[2]}" },
            year = yearMatch?.groupValues?.get(1)?.toIntOrNull(),
            currentMonth = "이번 달" in q || "금월" in q,
        )
    }

    private fun extractKeywords(question: String): List<String> {
        val product = PRODUCT.find(question)?.value
        val client = CLIENT.find(question)?.value
        return listOfNotNull(product, client) +
            question.split(Regex("[\\s,.?!'\"()]+"))
                .filter { it.length >= 2 }
                .take(5)
    }

    companion object {
        private val PRODUCT = Regex("(?i)Product-[A-Z0-9]+")
        private val CLIENT = Regex("(?i)Client-[A-Z0-9]+")
        private val DEPARTMENT = Regex("[가-힣A-Za-z0-9]+(?:사업부|부서|팀)")
        private val CATEGORY = Regex("(?i)(?:cloud|data|security|consulting|보안|클라우드|데이터|컨설팅)")
        private val REGION = Regex("(서울|부산|대전|광주|인천|대구|경기)")
        private val QUARTER = Regex("(20\\d{2})\\s*년?\\s*([1-4])\\s*분기")
        private val YEAR = Regex("(20\\d{2})\\s*년")
        private val LIMIT = Regex("(?:상위|최근)?\\s*([0-9]{1,2})\\s*(?:개|건|명)")
    }
}
