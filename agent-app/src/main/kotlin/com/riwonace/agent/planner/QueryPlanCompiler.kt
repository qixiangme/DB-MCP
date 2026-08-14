package com.riwonace.agent.planner

import com.riwonace.agent.router.Route
import org.springframework.stereotype.Component

/**
 * UnifiedQueryPlan을 실행 가능한 형태로 컴파일한다.
 *
 * - SqlQueryPlan → SQL 문자열 또는 Route.SQL
 * - GraphQueryPlan → kg_search 파라미터 또는 Route.GRAPH
 * - EvidencePlan → vector_search 파라미터 또는 Route.VECTOR
 */
@Component
class QueryPlanCompiler {

    data class CompiledPlan(
        val routes: List<Route>,
        val sql: String? = null,
        val graphQuery: GraphQuery? = null,
        val vectorQuery: VectorQuery? = null,
    )

    data class GraphQuery(
        val entity: String?,
        val predicate: String?,
        val direction: String,
        val hops: Int,
    )

    data class VectorQuery(
        val keywords: List<String>,
        val intent: String,
    )

    fun compile(plan: UnifiedQueryPlan): CompiledPlan {
        return when (plan) {
            is SqlQueryPlan -> compileSql(plan)
            is GraphQueryPlan -> compileGraph(plan)
            is EvidencePlan -> compileEvidence(plan)
            is CompositeQueryPlan -> compileComposite(plan)
        }
    }

    private fun compileSql(plan: SqlQueryPlan): CompiledPlan {
        val sql = buildSqlQuery(plan)
        return CompiledPlan(
            routes = listOf(Route.SQL),
            sql = sql,
        )
    }

    private fun buildSqlQuery(plan: SqlQueryPlan): String {
        val tableName = when (plan.subject) {
            SqlQueryPlan.Subject.EMPLOYEE -> "employees"
            SqlQueryPlan.Subject.CLIENT -> "clients"
            SqlQueryPlan.Subject.CONTRACT -> "contracts"
            SqlQueryPlan.Subject.PROJECT -> "projects"
            SqlQueryPlan.Subject.TICKET -> "support_tickets"
            SqlQueryPlan.Subject.PRODUCT -> "products"
            SqlQueryPlan.Subject.SALES -> "sales"
            SqlQueryPlan.Subject.DEPARTMENT -> "departments"
        }

        val selectClause = buildSelectClause(plan)
        val fromClause = buildFromClause(plan, tableName)
        val whereClause = buildWhereClause(plan)
        val groupByClause = buildGroupByClause(plan)
        val orderByClause = buildOrderByClause(plan)
        val limitClause = plan.limit?.let { "LIMIT $it" } ?: ""

        return listOf(selectClause, fromClause, whereClause, groupByClause, orderByClause, limitClause)
            .filter { it.isNotBlank() }
            .joinToString(" ")
    }

    private fun buildSelectClause(plan: SqlQueryPlan): String {
        val agg = when (plan.aggregation) {
            SqlQueryPlan.Aggregation.COUNT -> "count(*) AS count"
            SqlQueryPlan.Aggregation.SUM -> "sum(amount) AS total"
            SqlQueryPlan.Aggregation.AVG -> when (plan.subject) {
                SqlQueryPlan.Subject.EMPLOYEE -> "avg(salary) AS average_salary"
                SqlQueryPlan.Subject.SALES -> "avg(amount) AS average_sales"
                else -> "avg(amount) AS average"
            }
            SqlQueryPlan.Aggregation.MAX -> "max(amount) AS max"
            SqlQueryPlan.Aggregation.MIN -> "min(amount) AS min"
            SqlQueryPlan.Aggregation.NONE -> when (plan.subject) {
                SqlQueryPlan.Subject.EMPLOYEE -> "name, salary"
                SqlQueryPlan.Subject.CLIENT -> "name"
                SqlQueryPlan.Subject.PRODUCT -> "name, price_monthly"
                else -> "*"
            }
        }

        val groupColumn = when (plan.groupBy) {
            SqlQueryPlan.Dimension.DEPARTMENT -> "d.name AS department, "
            SqlQueryPlan.Dimension.REGION -> "region, "
            SqlQueryPlan.Dimension.CATEGORY -> "category, "
            SqlQueryPlan.Dimension.CLIENT -> "c.name AS client, "
            SqlQueryPlan.Dimension.PRODUCT -> "p.name AS product, "
            null -> ""
        }

        return "SELECT $groupColumn$agg"
    }

    private fun buildFromClause(plan: SqlQueryPlan, tableName: String): String {
        val joins = mutableListOf<String>()

        if (plan.groupBy == SqlQueryPlan.Dimension.DEPARTMENT || plan.filter.departmentName != null) {
            if (plan.subject == SqlQueryPlan.Subject.EMPLOYEE) {
                joins.add("JOIN departments d ON d.id = e.dept_id")
            }
        }

        if (plan.groupBy == SqlQueryPlan.Dimension.CATEGORY && plan.subject == SqlQueryPlan.Subject.SALES) {
            joins.add("JOIN products p ON p.id = s.product_id")
        }

        val alias = tableName.first().toString()
        val fromPart = "FROM $tableName $alias"
        return if (joins.isEmpty()) fromPart else "$fromPart ${joins.joinToString(" ")}"
    }

    private fun buildWhereClause(plan: SqlQueryPlan): String {
        val conditions = mutableListOf<String>()

        plan.filter.status?.let {
            conditions.add("status = '${it}'")
        }

        plan.filter.priority?.let {
            conditions.add("priority = '${it}'")
        }

        plan.filter.departmentName?.let {
            conditions.add("d.name = '${it}'")
        }

        plan.filter.region?.let {
            conditions.add("region = '${it}'")
        }

        plan.filter.category?.let {
            val normalized = normalizeCategory(it)
            conditions.add("category = '${normalized}'")
        }

        plan.filter.isNull.forEach {
            conditions.add("$it IS NULL")
        }

        plan.filter.notNull.forEach {
            conditions.add("$it IS NOT NULL")
        }

        plan.timeRange?.let { tr ->
            tr.quarter?.let {
                conditions.add("quarter = '${it}'")
            }
            tr.year?.let {
                conditions.add("EXTRACT(YEAR FROM created_at) = $it")
            }
            if (tr.currentMonth) {
                conditions.add("created_at >= date_trunc('month', current_date)")
            }
        }

        return if (conditions.isEmpty()) "" else "WHERE ${conditions.joinToString(" AND ")}"
    }

    private fun buildGroupByClause(plan: SqlQueryPlan): String {
        return when (plan.groupBy) {
            SqlQueryPlan.Dimension.DEPARTMENT -> "GROUP BY d.id, d.name"
            SqlQueryPlan.Dimension.REGION -> "GROUP BY region"
            SqlQueryPlan.Dimension.CATEGORY -> "GROUP BY category"
            SqlQueryPlan.Dimension.CLIENT -> "GROUP BY c.id, c.name"
            SqlQueryPlan.Dimension.PRODUCT -> "GROUP BY p.id, p.name"
            null -> ""
        }
    }

    private fun buildOrderByClause(plan: SqlQueryPlan): String {
        val direction = when (plan.order) {
            SqlQueryPlan.Order.DESC, SqlQueryPlan.Order.NEWEST -> "DESC"
            SqlQueryPlan.Order.ASC, SqlQueryPlan.Order.OLDEST -> "ASC"
            null -> return ""
        }

        val column = when (plan.aggregation) {
            SqlQueryPlan.Aggregation.COUNT -> "count"
            SqlQueryPlan.Aggregation.SUM -> "total"
            SqlQueryPlan.Aggregation.AVG -> when (plan.subject) {
                SqlQueryPlan.Subject.EMPLOYEE -> "average_salary"
                else -> "average"
            }
            else -> when (plan.order) {
                SqlQueryPlan.Order.NEWEST, SqlQueryPlan.Order.OLDEST -> "created_at"
                else -> "name"
            }
        }

        return "ORDER BY $column $direction"
    }

    private fun compileGraph(plan: GraphQueryPlan): CompiledPlan {
        val predicate = when (plan.predicate) {
            GraphQueryPlan.Predicate.USES -> "사용한다"
            GraphQueryPlan.Predicate.BELONGS_TO -> "소속"
            GraphQueryPlan.Predicate.MANAGES -> "담당한다"
            GraphQueryPlan.Predicate.LEADS -> "이끈다"
            GraphQueryPlan.Predicate.REPORTS_ISSUE -> "이슈보고"
            GraphQueryPlan.Predicate.HEAD_OF -> "부서장"
            GraphQueryPlan.Predicate.ANY -> null
        }

        return CompiledPlan(
            routes = listOf(Route.GRAPH),
            graphQuery = GraphQuery(
                entity = plan.entity,
                predicate = predicate,
                direction = plan.direction.name.lowercase(),
                hops = plan.hops,
            ),
        )
    }

    private fun compileEvidence(plan: EvidencePlan): CompiledPlan {
        return CompiledPlan(
            routes = listOf(Route.VECTOR),
            vectorQuery = VectorQuery(
                keywords = plan.keywords,
                intent = plan.intent.name.lowercase(),
            ),
        )
    }

    private fun compileComposite(plan: CompositeQueryPlan): CompiledPlan {
        val routes = plan.plans.flatMap { p ->
            when (p) {
                is SqlQueryPlan -> listOf(Route.SQL)
                is GraphQueryPlan -> listOf(Route.GRAPH)
                is EvidencePlan -> listOf(Route.VECTOR)
                else -> emptyList()
            }
        }.distinct()

        val sqlPlan = plan.plans.filterIsInstance<SqlQueryPlan>().firstOrNull()
        val graphPlan = plan.plans.filterIsInstance<GraphQueryPlan>().firstOrNull()
        val evidencePlan = plan.plans.filterIsInstance<EvidencePlan>().firstOrNull()

        return CompiledPlan(
            routes = routes,
            sql = sqlPlan?.let { buildSqlQuery(it) },
            graphQuery = graphPlan?.let {
                GraphQuery(
                    entity = it.entity,
                    predicate = when (it.predicate) {
                        GraphQueryPlan.Predicate.USES -> "사용한다"
                        GraphQueryPlan.Predicate.BELONGS_TO -> "소속"
                        GraphQueryPlan.Predicate.MANAGES -> "담당한다"
                        else -> null
                    },
                    direction = it.direction.name.lowercase(),
                    hops = it.hops,
                )
            },
            vectorQuery = evidencePlan?.let {
                VectorQuery(keywords = it.keywords, intent = it.intent.name.lowercase())
            },
        )
    }

    private fun normalizeCategory(value: String): String = when (value.lowercase()) {
        "보안", "보안 솔루션" -> "security"
        "클라우드" -> "cloud"
        "데이터" -> "data"
        "컨설팅" -> "consulting"
        else -> value.lowercase()
    }
}
