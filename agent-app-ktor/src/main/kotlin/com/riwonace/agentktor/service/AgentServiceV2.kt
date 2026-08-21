package com.riwonace.agentktor.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.riwonace.agentktor.context.ContextItem
import com.riwonace.agentktor.core.*
import com.riwonace.agentktor.llm.OllamaChatClient
import com.riwonace.agentktor.mcp.McpGateway
import com.riwonace.agentktor.router.Route
import com.riwonace.agentktor.sql.FewShotSelector
import com.riwonace.agentktor.sql.SchemaLinker
import com.riwonace.agentktor.sql.SchemaPromptFormatter
import org.slf4j.LoggerFactory
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Ports AgentServiceV2.kt 1:1 (Architecture v2's profile -> DAG execution -> evidence
 * optimization -> answerability gate -> Ollama answer generation pipeline). v1
 * (AgentService) is out of scope, same decision as agent-app-go's port -- v2 is the
 * production default (agent.v2.enabled=true in the baseline).
 */
class AgentServiceV2(
    private val planner: ExecutionPlanner,
    private val optimizer: EvidenceOptimizer,
    private val gate: AnswerabilityGate,
    private val recovery: RecoveryPolicy,
    private val escalator: ModelEscalator,
    private val gateway: McpGateway,
    private val chatClient: OllamaChatClient,
    private val mapper: ObjectMapper,
    private val fewShotSelector: FewShotSelector,
    private val schemaLinker: SchemaLinker,
    private val schemaPromptFormatter: SchemaPromptFormatter,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val executor = Executors.newFixedThreadPool(4)

    companion object {
        private const val MAX_SQL_RETRIES = 2
    }

    fun shutdown() {
        log.info("AgentServiceV2 스레드 풀 종료")
        executor.shutdown()
        if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
            executor.shutdownNow()
        }
    }

    data class AgentAnswerV2(
        val answer: String,
        val routes: List<Route>,
        val toolCalls: List<String>,
        val contextSources: List<String>,
        val latencyMs: Long,
        val trace: ExecutionTrace?,
        val selectedModel: String?,
        val claimCoverage: Double?,
        val wasEscalated: Boolean,
    )

    fun chat(question: String): AgentAnswerV2 {
        val started = System.currentTimeMillis()
        val toolCalls = mutableListOf<String>()
        val nodeTraces = mutableListOf<NodeTrace>()

        val plan = planner.plan(question)
        log.info("실행 계획 생성: {} 노드, 모델={}", plan.nodes.size, plan.selectedModel)

        val items = executePlan(plan, toolCalls, nodeTraces)

        val optimized = optimizer.optimize(items, plan.profile.suggestedRoutes, plan.profile)
        log.info("증거 최적화: {} → {} 항목", items.size, optimized.selected.size)

        val gateResult = gate.verify(question, optimized.selected, plan.profile)
        var finalEvidence = optimized.selected
        var wasEscalated = false

        when (gateResult.recommendedAction) {
            AnswerabilityGate.GateAction.SEARCH_MORE -> {
                log.info("추가 검색 필요: missing={}", gateResult.missingClaims)
                val additionalItems = searchAdditional(question, gateResult.missingClaims, toolCalls)
                val combined = optimizer.optimize(items + additionalItems, plan.profile.suggestedRoutes, plan.profile)
                finalEvidence = combined.selected
            }
            AnswerabilityGate.GateAction.DECLINE -> {
                return createDeclineResponse(question, plan, started, nodeTraces, toolCalls)
            }
            else -> { /* PROCEED or PARTIAL_ANSWER */ }
        }

        var modelSelection = escalator.selectModel(plan.profile)
        var answer = generateAnswer(question, finalEvidence, modelSelection.model)

        val answerQuality = estimateAnswerQuality(answer, question)
        if (answerQuality < 0.6 || gateResult.claimCoverage < 0.7) {
            val reescalation = escalator.shouldReescalate(modelSelection, answerQuality, gateResult.claimCoverage)
            if (reescalation != null) {
                log.info("모델 재에스컬레이션: {} → {}", modelSelection.model, reescalation.model)
                answer = generateAnswer(question, finalEvidence, reescalation.model)
                modelSelection = reescalation
                wasEscalated = true
            }
        }

        val totalDuration = System.currentTimeMillis() - started

        val trace = ExecutionTrace(
            plan = plan,
            nodeTraces = nodeTraces,
            totalDurationMs = totalDuration,
            finalAnswer = answer,
            evidenceSources = finalEvidence.map { it.source },
            claimCoverage = gateResult.claimCoverage,
        )

        return AgentAnswerV2(
            answer = answer,
            routes = plan.profile.suggestedRoutes,
            toolCalls = toolCalls,
            contextSources = finalEvidence.map { it.source },
            latencyMs = totalDuration,
            trace = trace,
            selectedModel = modelSelection.model,
            claimCoverage = gateResult.claimCoverage,
            wasEscalated = wasEscalated,
        )
    }

    private fun executePlan(
        plan: ExecutionPlan,
        toolCalls: MutableList<String>,
        nodeTraces: MutableList<NodeTrace>,
    ): List<ContextItem> {
        val results = mutableMapOf<String, Any?>()
        val items = mutableListOf<ContextItem>()

        val levels = groupByDependencyLevel(plan.nodes)

        for (level in levels) {
            val futures = level.map { node ->
                CompletableFuture.supplyAsync({
                    executeNode(node, results, toolCalls, nodeTraces)
                }, executor)
            }
            futures.forEach { future -> items.addAll(future.join()) }
        }

        return items
    }

    private fun executeNode(
        node: PlanNode,
        results: MutableMap<String, Any?>,
        toolCalls: MutableList<String>,
        nodeTraces: MutableList<NodeTrace>,
    ): List<ContextItem> {
        val startedAt = System.currentTimeMillis()
        node.status = NodeStatus.RUNNING

        if (node.condition != null && !evaluateCondition(node.condition!!, results)) {
            node.status = NodeStatus.SKIPPED
            nodeTraces.add(createNodeTrace(node, startedAt, "조건 미충족으로 스킵"))
            return emptyList()
        }

        val input = resolveTemplate(node.inputTemplate, results)

        try {
            val items = collectContext(node.route, input, toolCalls)

            node.status = NodeStatus.SUCCESS
            if (node.outputBinding != null) results[node.outputBinding!!] = items

            nodeTraces.add(createNodeTrace(node, startedAt, "성공: ${items.size}개 항목"))
            return items
        } catch (e: Exception) {
            log.warn("노드 {} 실행 실패: {}", node.id, e.message)

            val classification = recovery.classifyFailure(e.message ?: "unknown", node.route)
            val strategy = recovery.determineStrategy(classification, node.route, 0, input)

            node.status = NodeStatus.FAILED
            nodeTraces.add(createNodeTrace(node, startedAt, "실패: ${e.message?.take(50)}"))

            for (fallbackRoute in strategy.fallbackRoutes) {
                try {
                    val fallbackItems = collectContext(fallbackRoute, input, toolCalls)
                    if (fallbackItems.isNotEmpty()) return fallbackItems
                } catch (_: Exception) { /* try next fallback */ }
            }

            return emptyList()
        }
    }

    private fun collectContext(route: Route, question: String, toolCalls: MutableList<String>): List<ContextItem> {
        return when (route) {
            Route.VECTOR -> {
                toolCalls += "vector_search"
                parseVectorResult(gateway.vectorSearch(question))
            }
            Route.GRAPH -> {
                toolCalls += "kg_search"
                val result = gateway.kgSearch(question)
                listOf(ContextItem("knowledge-graph", "지식 그래프 관계:\n$result", 0.9))
            }
            Route.SQL -> {
                toolCalls += "get_schema"
                toolCalls += "run_sql"
                var sql = generateSql(question)
                var result = gateway.runSql(sql)
                var retryCount = 0

                while (retryCount < MAX_SQL_RETRIES) {
                    val feedback = analyzeSqlResult(result, question) ?: break
                    log.info("SQL 자가수정 {}/{}: {}", retryCount + 1, MAX_SQL_RETRIES, feedback.take(100))
                    toolCalls += "run_sql(retry-${retryCount + 1})"
                    sql = generateSql(question, previousAttempt = sql, error = feedback)
                    result = gateway.runSql(sql)
                    retryCount++
                }
                listOf(ContextItem("sql", "실행한 SQL: $sql\n조회 결과:\n${humanizeSqlResult(result)}", 1.0))
            }
        }
    }

    private fun searchAdditional(question: String, missingClaims: List<String>, toolCalls: MutableList<String>): List<ContextItem> {
        val items = mutableListOf<ContextItem>()

        for (claim in missingClaims.take(2)) {
            try {
                when {
                    claim.contains("entity_") -> {
                        val entity = claim.removePrefix("entity_")
                        toolCalls += "vector_search(additional)"
                        items.addAll(parseVectorResult(gateway.vectorSearch(entity)))
                    }
                    claim in listOf("quantity_value", "aggregated_value") -> {
                        toolCalls += "run_sql(additional)"
                        val sql = generateSql(question)
                        val result = gateway.runSql(sql)
                        items.add(ContextItem("sql", humanizeSqlResult(result), 0.8))
                    }
                    else -> {
                        toolCalls += "vector_search(additional)"
                        items.addAll(parseVectorResult(gateway.vectorSearch(question)))
                    }
                }
            } catch (e: Exception) {
                log.warn("추가 검색 실패: {}", e.message)
            }
        }

        return items
    }

    private fun estimateAnswerQuality(answer: String, question: String): Double {
        var score = 0.5
        if (answer.length >= 50) score += 0.1
        if (answer.length >= 100) score += 0.1
        if (answer.contains("출처") || answer.contains("[")) score += 0.1
        if (answer.contains("찾을 수 없") || answer.contains("알 수 없")) score -= 0.2
        if ((question.contains("몇") || question.contains("얼마")) && answer.contains(Regex("\\d+"))) score += 0.15
        return score.coerceIn(0.0, 1.0)
    }

    private fun createDeclineResponse(
        question: String,
        plan: ExecutionPlan,
        started: Long,
        nodeTraces: List<NodeTrace>,
        toolCalls: List<String>,
    ): AgentAnswerV2 {
        val answer = "죄송합니다. '$question'에 대해 충분한 정보를 찾지 못했습니다. " +
            "질문을 더 구체적으로 해주시거나 다른 방식으로 질문해 주세요."

        return AgentAnswerV2(
            answer = answer,
            routes = plan.profile.suggestedRoutes,
            toolCalls = toolCalls,
            contextSources = emptyList(),
            latencyMs = System.currentTimeMillis() - started,
            trace = ExecutionTrace(
                plan = plan,
                nodeTraces = nodeTraces,
                totalDurationMs = System.currentTimeMillis() - started,
                finalAnswer = answer,
                evidenceSources = emptyList(),
                claimCoverage = 0.0,
            ),
            selectedModel = plan.selectedModel,
            claimCoverage = 0.0,
            wasEscalated = false,
        )
    }

    private fun groupByDependencyLevel(nodes: List<PlanNode>): List<List<PlanNode>> {
        val levels = mutableListOf<List<PlanNode>>()
        val remaining = nodes.toMutableList()
        val completed = mutableSetOf<String>()

        while (remaining.isNotEmpty()) {
            val currentLevel = remaining.filter { node -> node.dependsOn.all { it in completed } }

            if (currentLevel.isEmpty() && remaining.isNotEmpty()) {
                levels.add(remaining.toList())
                break
            }

            levels.add(currentLevel)
            completed.addAll(currentLevel.map { it.id })
            remaining.removeAll(currentLevel.toSet())
        }

        return levels
    }

    private fun evaluateCondition(condition: ExecutionCondition, results: Map<String, Any?>): Boolean {
        val value = results[condition.variable]
        return when (condition.type) {
            ConditionType.NOT_EMPTY -> when (value) {
                null -> false
                is List<*> -> value.isNotEmpty()
                is String -> value.isNotBlank()
                else -> true
            }
            ConditionType.ON_FAILURE -> value == null
            ConditionType.ALWAYS -> true
            else -> true
        }
    }

    private fun resolveTemplate(template: String, results: Map<String, Any?>): String {
        var resolved = template
        val pattern = Regex("\\$\\{([^}]+)}")

        pattern.findAll(template).forEach { match ->
            val varName = match.groupValues[1]
            val value = results[varName]
            val replacement = when (value) {
                is List<*> -> (value as? List<ContextItem>)?.joinToString(", ") { it.text.take(50) } ?: ""
                else -> value?.toString() ?: ""
            }
            resolved = resolved.replace(match.value, replacement)
        }

        return resolved
    }

    private fun createNodeTrace(node: PlanNode, startedAt: Long, resultSummary: String): NodeTrace {
        return NodeTrace(
            nodeId = node.id,
            route = node.route,
            status = node.status,
            startedAt = startedAt,
            endedAt = System.currentTimeMillis(),
            resultSummary = resultSummary,
        )
    }

    private fun generateSql(question: String, previousAttempt: String? = null, error: String? = null): String {
        val rawSchema = gateway.schema()
        val schema = schemaPromptFormatter.format(rawSchema)
        val selectedExamples = fewShotSelector.selectExamples(question, topK = 1)
        val examplesBlock = fewShotSelector.formatExamplesForPrompt(selectedExamples)
        val schemaHints = schemaLinker.linkEntities(rawSchema, question)
        val hintBlock = schemaLinker.formatHintsForPrompt(schemaHints)

        val retryBlock = if (previousAttempt == null) ""
        else "직전 시도: $previousAttempt\n오류: ${error?.take(300)}\n오류를 고쳐서 다시 작성한다.\n\n"

        val system = "너는 PostgreSQL 전문가다. 주어진 스키마만 사용해서 질문에 답하는 " +
            "SELECT 문 한 문장만 출력한다. TABLE에 없는 식별자를 만들지 않고, " +
            "JOIN은 FOREIGN KEYS에 제시된 관계만 사용한다. " +
            "설명, 마크다운, 세미콜론 없이 SQL만 출력한다." +
            if (schemaHints.isNotEmpty()) " 스키마 힌트에 표시된 테이블.컬럼과 값을 반드시 사용한다." else ""

        val user = "스키마:\n$schema$hintBlock\n\n$examplesBlock\n\n${retryBlock}질문: $question\nSQL:"

        val raw = chatClient.complete(system, user)

        return raw.replace(Regex("```(sql)?", RegexOption.IGNORE_CASE), "").trim().removeSuffix(";")
    }

    @Suppress("UNCHECKED_CAST")
    private fun humanizeSqlResult(json: String): String = try {
        val parsed: Map<String, Any?> = mapper.readValue(
            json,
            mapper.typeFactory.constructMapType(Map::class.java, String::class.java, Any::class.java),
        )
        val rows = parsed["rows"] as? List<Map<String, Any?>> ?: return json
        if (rows.isEmpty()) "조회 결과 없음 (0행)"
        else rows.joinToString("\n") { row -> row.entries.joinToString(", ") { "${it.key}=${it.value}" } }
    } catch (e: Exception) { json }

    @Suppress("UNCHECKED_CAST")
    private fun analyzeSqlResult(json: String, question: String): String? = try {
        val parsed: Map<String, Any?> = mapper.readValue(
            json,
            mapper.typeFactory.constructMapType(Map::class.java, String::class.java, Any::class.java),
        )
        val error = parsed["error"]?.toString()
        if (!error.isNullOrBlank()) "SQL 실행 오류: $error"
        else {
            val rows = parsed["rows"] as? List<Map<String, Any?>>
            when {
                rows == null -> "응답에 rows 필드가 없음"
                rows.isEmpty() -> {
                    val negationKeywords = listOf("없", "아닌", "제외", "빼고", "않")
                    if (!negationKeywords.any { question.contains(it) }) "조회 결과가 0행임" else null
                }
                else -> null
            }
        }
    } catch (e: Exception) { "SQL 결과 파싱 실패: ${e.message}" }

    private fun parseVectorResult(json: String): List<ContextItem> = try {
        val docs: List<Map<String, Any?>> = mapper.readValue(
            json,
            mapper.typeFactory.constructCollectionType(List::class.java, Map::class.java),
        )
        docs.map {
            ContextItem(
                source = it["source"]?.toString() ?: "document",
                text = it["text"]?.toString() ?: "",
                score = (it["score"] as? Number)?.toDouble() ?: 0.5,
            )
        }
    } catch (e: Exception) {
        listOf(ContextItem("document", json, 0.5))
    }

    private fun generateAnswer(question: String, context: List<ContextItem>, model: String): String {
        val contextBlock = if (context.isEmpty()) "(검색된 컨텍스트 없음)"
        else context.joinToString("\n\n") { "[출처: ${it.source}]\n${it.text}" }

        log.debug("답변 생성: model={}, context_size={}", model, context.size)

        val system = "너는 리원에이스의 데이터 플랫폼 AI 비서다. " +
            "아래 컨텍스트에서 질문과 관련된 정보를 찾아 한국어로 답한다. " +
            "컨텍스트에 장애 보고서, 기술 문서, 회의록 등이 있으면 핵심 내용(고객사, 제품, 원인, 조치사항 등)을 요약한다. " +
            "답변 끝에 출처를 표기한다."
        val user = "컨텍스트:\n$contextBlock\n\n질문: $question"

        return chatClient.complete(system, user)
    }
}
