package com.riwonace.agent.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.riwonace.agent.context.ContextCurator
import com.riwonace.agent.context.ContextItem
import com.riwonace.agent.mcp.McpGateway
import com.riwonace.agent.router.Route
import com.riwonace.agent.router.RuleBasedRouter
import org.slf4j.LoggerFactory
import org.springframework.ai.chat.client.ChatClient
import org.springframework.stereotype.Service
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors

/**
 * 에이전트 API의 관측 가능한 실행 결과.
 *
 * @property routes 질문에 선택된 검색 경로
 * @property toolCalls 실제로 시도한 MCP 도구 호출 순서
 * @property contextSources 최종 답변 컨텍스트에 포함된 출처
 * @property latencyMs 라우팅부터 답변 생성까지의 전체 지연 시간
 */
data class AgentAnswer(
    val answer: String,
    val routes: List<Route>,
    val toolCalls: List<String>,
    val contextSources: List<String>,
    val latencyMs: Long,
)

/**
 * 에이전트 오케스트레이터: 라우팅 → MCP 도구 병렬 호출 → TACC 큐레이션 → 답변 생성.
 * (Pylon-7 기준 L4 라우팅 / L5 컨텍스트 구성 / L6 추론 계층에 해당)
 */
@Service
class AgentService(
    private val router: RuleBasedRouter,
    private val gateway: McpGateway,
    private val curator: ContextCurator,
    private val chatClient: ChatClient,
    private val mapper: ObjectMapper,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val executor = Executors.newFixedThreadPool(4)

    companion object {
        /** Self-Corrective SQL 최대 재시도 횟수 (Self-RAG ICLR 2024 영감) */
        private const val MAX_SQL_RETRIES = 2
    }

    /** 질문을 라우팅하고 근거를 수집·선별한 뒤 출처가 포함된 답변을 생성한다. */
    fun chat(question: String): AgentAnswer {
        val started = System.currentTimeMillis()
        val routes = router.route(question)
        val toolCalls = mutableListOf<String>()
        log.info("질문 라우팅 결과: {} → {}", question, routes)

        // MCP Parallel 패턴: 선택된 도구들을 병렬 호출
        val futures = routes.map { route ->
            CompletableFuture.supplyAsync({ collectContext(route, question, toolCalls) }, executor)
        }
        val items = futures.flatMap { it.join() }

        val curated = curator.curate(items, routes)
        val answer = generateAnswer(question, curated)

        return AgentAnswer(
            answer = answer,
            routes = routes,
            toolCalls = toolCalls,
            contextSources = curated.map { it.source },
            latencyMs = System.currentTimeMillis() - started,
        )
    }

    private fun collectContext(route: Route, question: String, toolCalls: MutableList<String>): List<ContextItem> =
        try {
            when (route) {
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

                    // Self-Corrective SQL: 2단계 검증과 최대 2회 자가수정
                    // 논문 참고: Self-RAG (ICLR 2024) - 생성 결과를 자가 비평하고 필요시 재시도
                    while (retryCount < MAX_SQL_RETRIES) {
                        val feedback = analyzeSqlResult(result, question)
                        if (feedback == null) break

                        log.info("run_sql 자가수정 재시도 {}/{} — 사유: {}", retryCount + 1, MAX_SQL_RETRIES, feedback.take(100))
                        toolCalls += "run_sql(retry-${retryCount + 1})"
                        sql = generateSql(question, previousAttempt = sql, error = feedback)
                        result = gateway.runSql(sql)
                        retryCount++
                    }
                    listOf(ContextItem("sql", "실행한 SQL: $sql\n조회 결과:\n${humanizeSqlResult(result)}", 1.0))
                }
            }
        } catch (e: Exception) {
            log.warn("{} 라우트 컨텍스트 수집 실패: {}", route, e.message)
            emptyList()
        }

    /**
     * NL2SQL: MCP로 받은 스키마를 근거로 소형 LLM이 SELECT 한 문장을 생성한다.
     * 1B급 모델 안정화를 위해 원샷 예시를 포함한다 (출력 형식을 좁힐수록 소형 모델이 안정적이다).
     */
    private fun generateSql(question: String, previousAttempt: String? = null, error: String? = null): String {
        val schema = gateway.schema()
        val retryBlock =
            if (previousAttempt == null) ""
            else "직전 시도: $previousAttempt\n오류: ${error?.take(300)}\n오류를 고쳐서 다시 작성한다.\n\n"
        val raw = chatClient.prompt()
            .system(
                "너는 PostgreSQL 전문가다. 주어진 스키마만 사용해서 질문에 답하는 " +
                    "SELECT 문 한 문장만 출력한다. 설명, 마크다운, 세미콜론 없이 SQL만 출력한다.",
            )
            .user(
                "스키마:\n$schema\n\n" +
                    // 예시 2개: 1B 모델은 예시 하나면 그 WHERE절까지 그대로 베낀다.
                    // 필터 집계 + 조인 패턴을 모두 보여 패턴을 분리한다.
                    "예시1 — 질문: 완료된 프로젝트는 몇 개야?\n" +
                    "SQL: SELECT count(*) FROM projects WHERE status = 'completed'\n" +
                    "예시2 — 질문: 영업팀 직원 이름과 연봉을 알려줘\n" +
                    "SQL: SELECT e.name, e.salary FROM employees e JOIN departments d ON e.dept_id = d.id WHERE d.name = '영업팀'\n\n" +
                    retryBlock +
                    "질문: $question\nSQL:",
            )
            .call()
            .content()
            .orEmpty()
        val sql = raw
            .replace(Regex("```(sql)?", RegexOption.IGNORE_CASE), "")
            .trim()
            .removeSuffix(";")
        log.info("NL2SQL 생성 결과: {}", sql)
        return sql
    }

    /**
     * run_sql의 JSON 결과를 "컬럼=값" 텍스트로 풀어쓴다.
     * 소형 모델은 {"rows":[{"count":8}]} 같은 중첩 JSON을 답으로 인식하지 못하고
     * '찾을 수 없다'고 답하는 경향이 있다 (벤치마크로 확인).
     */
    @Suppress("UNCHECKED_CAST")
    private fun humanizeSqlResult(json: String): String =
        try {
            val parsed: Map<String, Any?> = mapper.readValue(
                json,
                mapper.typeFactory.constructMapType(Map::class.java, String::class.java, Any::class.java),
            )
            val rows = parsed["rows"] as? List<Map<String, Any?>> ?: return json
            if (rows.isEmpty()) "조회 결과 없음 (0행)"
            else rows.joinToString("\n") { row ->
                row.entries.joinToString(", ") { "${it.key}=${it.value}" }
            }
        } catch (e: Exception) {
            json
        }

    /**
     * Self-Corrective SQL: 결과를 분석하여 재시도 필요 여부를 판단한다.
     * 논문 참고: Self-RAG (ICLR 2024) - 생성 결과를 자가 비평하고 필요시 재시도
     *
     * @return 재시도가 필요하면 피드백 문자열, 불필요하면 null
     */
    @Suppress("UNCHECKED_CAST")
    private fun analyzeSqlResult(json: String, question: String): String? {
        return try {
            // 1단계: JSON 파싱 오류 검출
            val parsed: Map<String, Any?> = mapper.readValue(
                json,
                mapper.typeFactory.constructMapType(Map::class.java, String::class.java, Any::class.java),
            )

            // 2단계: 에러 응답 검출
            val error = parsed["error"]?.toString()
            if (!error.isNullOrBlank()) {
                "SQL 실행 오류: $error"
            } else {
                // 3단계: 빈 결과 검출 (0행)
                val rows = parsed["rows"] as? List<Map<String, Any?>>
                when {
                    rows == null -> "응답에 rows 필드가 없음"
                    rows.isEmpty() -> {
                        // 빈 결과가 예상되는 질문인지 확인 (부정형 질문)
                        val negationKeywords = listOf("없", "아닌", "제외", "빼고", "않")
                        val isNegationQuestion = negationKeywords.any { question.contains(it) }
                        if (!isNegationQuestion) {
                            "조회 결과가 0행임. 조건을 완화하거나 테이블/컬럼명을 확인해야 함"
                        } else {
                            null
                        }
                    }
                    else -> {
                        // 4단계: 결과 유효성 검증 (NULL 값 과다)
                        val nullCount = rows.sumOf { row -> row.values.count { it == null } }
                        val totalValues = rows.size * rows.first().size
                        if (totalValues > 0 && nullCount.toDouble() / totalValues > 0.5) {
                            "결과의 50% 이상이 NULL임. JOIN 조건이나 컬럼 선택을 확인해야 함"
                        } else {
                            null // 검증 통과
                        }
                    }
                }
            }
        } catch (e: Exception) {
            // JSON 파싱 실패 = SQL 실행 자체가 실패한 것
            "SQL 결과 파싱 실패: ${e.message}"
        }
    }

    private fun parseVectorResult(json: String): List<ContextItem> =
        try {
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
            log.warn("vector_search 결과 파싱 실패: {}", e.message)
            listOf(ContextItem("document", json, 0.5))
        }

    private fun generateAnswer(question: String, context: List<ContextItem>): String {
        val contextBlock =
            if (context.isEmpty()) "(검색된 컨텍스트 없음)"
            else context.joinToString("\n\n") { "[출처: ${it.source}]\n${it.text}" }

        return chatClient.prompt()
            .system(
                "너는 리원에이스의 데이터 플랫폼 AI 비서다. " +
                    "반드시 아래 제공된 컨텍스트에 근거해서만 한국어로 답하고, " +
                    "컨텍스트에 없는 내용은 '제공된 데이터에서 찾을 수 없습니다'라고 답한다. " +
                    "답변 끝에 사용한 출처를 표기한다.",
            )
            .user("컨텍스트:\n$contextBlock\n\n질문: $question")
            .call()
            .content()
            .orEmpty()
    }
}
