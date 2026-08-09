package com.riwonace.agent.context

import com.riwonace.agent.router.Route
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

data class ContextItem(
    val source: String,
    val text: String,
    val score: Double,
)

/**
 * TACC(선별적 컨텍스트 큐레이션) 구현.
 *
 * 전현우 외(2026)는 전체 컨텍스트가 빈 기준선보다 유리하되, 추가 구성요소의 한계효용이
 * 모델과 과업에 따라 달라짐을 보였다. 특히 Knowledge(K)만 유의한 주효과를 보였으므로,
 * 이 구현은 "무조건 적게"가 아니라 관련 있는 근거를 예산 안에서 우선 제공한다.
 *
 * 1) 관련도 하한선 미달 항목은 예산이 남아도 버리고
 * 2) 과업 유형(라우트)에 따라 예산과 소스별 가중치를 다르게 주며
 * 3) 최상위 항목을 맨 앞, 차상위를 맨 뒤에 배치한다 (Liu et al., 2024의
 *    'Lost in the Middle' 완화). recency 단독 배치(최상위를 맨 뒤)도
 *    벤치마크로 A/B 검증했으나 gemma3:1b는 첫 항목 우선 사용 경향이
 *    강해 오히려 하락 — 실측 근거로 기각했다.
 */
@Component
class ContextCurator(
    @Value("\${agent.context.budget-chars:2400}") private val budgetChars: Int,
) {

    init {
        require(budgetChars > 0) { "agent.context.budget-chars는 0보다 커야 합니다." }
    }

    fun curate(items: List<ContextItem>, routes: List<Route>): List<ContextItem> {
        if (items.isEmpty()) return emptyList()

        // 과업 인지 예산: SQL 단독 라우트는 조회 결과가 결정적이라 절반 예산으로 충분
        val budget = if (routes == listOf(Route.SQL)) budgetChars / 2 else budgetChars

        val weighted = items
            .filter { it.score >= MIN_SCORE }
            .distinctBy { it.text.take(80) }
            .map { it.copy(score = it.score * weightFor(it.source, routes)) }
            .sortedByDescending { it.score }

        val selected = mutableListOf<ContextItem>()
        var used = 0
        for (item in weighted) {
            val remaining = budget - used
            if (remaining <= 0) break
            if (item.text.length <= remaining) {
                selected += item
                used += item.text.length
            } else if (selected.isEmpty()) {
                // 최고 관련 항목 하나도 없는 것보다 경계에서 안전하게 줄인 근거가 낫다.
                // JSON 원문을 자르는 계층이 아니라 사람이 읽는 ContextItem 경계에서만 수행한다.
                val truncated = truncateAtBoundary(item.text, remaining)
                if (truncated.isNotEmpty()) {
                    selected += item.copy(text = truncated)
                    used += truncated.length
                }
            }
        }

        // 최상위 항목은 맨 앞, 차상위 항목은 맨 뒤로 배치
        if (selected.size >= 3) {
            val second = selected.removeAt(1)
            selected.add(second)
        }
        return selected
    }

    /** 단어·줄 경계를 우선해 자르고, 반환 길이가 반드시 maxChars 이하가 되게 한다. */
    private fun truncateAtBoundary(text: String, maxChars: Int): String {
        if (text.length <= maxChars) return text
        if (maxChars <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.take(maxChars)

        val contentLimit = maxChars - TRUNCATION_MARKER.length
        val prefix = text.take(contentLimit)
        val boundary = maxOf(prefix.lastIndexOf('\n'), prefix.lastIndexOf(' '))
        val content = if (boundary >= contentLimit / 2) prefix.take(boundary).trimEnd() else prefix
        return content + TRUNCATION_MARKER
    }

    private fun weightFor(source: String, routes: List<Route>): Double = when {
        source == "sql" && Route.SQL in routes -> 1.5
        source == "knowledge-graph" && Route.GRAPH in routes -> 1.3
        else -> 1.0
    }

    companion object {
        /** 관련도 하한선 — 이 미만은 노이즈로 간주하고 투입하지 않는다 */
        const val MIN_SCORE = 0.25
        private const val TRUNCATION_MARKER = "\n…(truncated)"
    }
}
