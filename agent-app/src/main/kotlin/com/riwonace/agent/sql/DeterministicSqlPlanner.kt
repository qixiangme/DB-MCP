package com.riwonace.agent.sql

import org.springframework.stereotype.Component

/**
 * Company-X 스키마에서 의미가 모호하지 않은 반복 질의를 결정적 SELECT로 컴파일한다.
 * 고신뢰 패턴 밖의 질문은 null을 반환해 LLM NL2SQL 경로가 처리하게 한다.
 */
@Component
class DeterministicSqlPlanner {

    fun plan(question: String): String? {
        val q = question.lowercase()
        val product = PRODUCT.find(question)?.value
        val client = CLIENT.find(question)?.value
        val department = DEPARTMENT.find(question)?.value

        if (product != null) {
            val literal = quote(product)
            return when {
                isActiveContractAmount(q) ->
                    "SELECT sum(c.amount) AS total_amount FROM contracts c JOIN products p ON c.product_id = p.id " +
                        "WHERE c.status = 'active' AND p.name = $literal"
                isActiveContractCount(q) ->
                    "SELECT count(*) AS count FROM contracts c JOIN products p ON c.product_id = p.id " +
                        "WHERE c.status = 'active' AND p.name = $literal"
                isTotalSales(q) ->
                    "SELECT sum(s.amount) AS total_sales FROM sales s JOIN products p ON s.product_id = p.id " +
                        "WHERE p.name = $literal"
                isMonthlyPrice(q) -> "SELECT price_monthly FROM products WHERE name = $literal"
                isReleaseStatus(q) -> "SELECT status FROM products WHERE name = $literal"
                else -> null
            }
        }

        if (client != null && isTotalSales(q)) {
            return "SELECT sum(s.amount) AS total_sales FROM sales s JOIN clients c ON s.client_id = c.id " +
                "WHERE c.name = ${quote(client)}"
        }

        if (department != null && isAverageSalary(q)) {
            return "SELECT avg(e.salary) AS average_salary FROM employees e " +
                "JOIN departments d ON e.dept_id = d.id WHERE d.name = ${quote(department)}"
        }

        val category = CATEGORY.find(q)?.value
        if (category != null) {
            ACTIVE_AMOUNT.find(question)?.groupValues?.get(1)?.toIntValue()?.takeIf { isActiveContractAmount(q) }?.let { amount ->
                return "SELECT p.name FROM contracts c JOIN products p ON c.product_id = p.id " +
                    "WHERE c.status = 'active' AND p.category = ${quote(category)} " +
                    "GROUP BY p.id, p.name HAVING sum(c.amount) = $amount"
            }
            ACTIVE_COUNT.find(question)?.groupValues?.get(1)?.toIntValue()?.takeIf { isActiveContractCount(q) }?.let { count ->
                return "SELECT p.name FROM contracts c JOIN products p ON c.product_id = p.id " +
                    "WHERE c.status = 'active' AND p.category = ${quote(category)} " +
                    "GROUP BY p.id, p.name HAVING count(*) = $count"
            }
            MONTHLY_PRICE.find(question)?.groupValues?.get(1)?.toIntValue()?.let { price ->
                return "SELECT name FROM products WHERE category = ${quote(category)} AND price_monthly = $price"
            }
        }
        return null
    }

    private fun isMonthlyPrice(q: String) = "가격" in q || "price" in q
    private fun isReleaseStatus(q: String) = "출시 상태" in q || "release status" in q
    private fun isActiveContractCount(q: String) = "활성" in q && "계약" in q && listOf("수", "건", "개").any(q::contains)
    private fun isActiveContractAmount(q: String) = "활성" in q && "계약" in q && listOf("금액", "합계", "총액").any(q::contains)
    private fun isTotalSales(q: String) = "매출" in q && listOf("총", "전체", "합계").any(q::contains)
    private fun isAverageSalary(q: String) = "평균" in q && ("급여" in q || "연봉" in q)
    private fun quote(value: String) = "'${value.replace("'", "''")}'"
    private fun String.toIntValue(): Long? = replace(",", "").toLongOrNull()

    companion object {
        private val PRODUCT = Regex("(?i)Product-[A-Z0-9]+")
        private val CLIENT = Regex("(?i)Client-[A-Z0-9]+")
        private val DEPARTMENT = Regex("[가-힣A-Za-z0-9]+(?:사업부|부서|팀)")
        private val CATEGORY = Regex("(?i)(?:cloud|data|security|consulting)")
        private val ACTIVE_AMOUNT = Regex("활성\\s*계약[^0-9]{0,12}([0-9][0-9,]*)")
        private val ACTIVE_COUNT = Regex("활성\\s*계약[^0-9]{0,12}([0-9][0-9,]*)\\s*건")
        private val MONTHLY_PRICE = Regex("월\\s*([0-9][0-9,]*)")
    }
}
