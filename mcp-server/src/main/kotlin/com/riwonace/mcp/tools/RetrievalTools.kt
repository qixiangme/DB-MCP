package com.riwonace.mcp.tools

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.ai.tool.annotation.Tool
import org.springframework.ai.tool.annotation.ToolParam
import org.springframework.ai.vectorstore.SearchRequest
import org.springframework.ai.vectorstore.VectorStore
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

/**
 * MCP 표준 규격으로 노출되는 데이터 플랫폼 실행 도구 3종.
 * 에이전트는 이 도구들만 알면 되고, DB 접속 정보·임베딩 모델 등
 * 내부 구현은 알 필요가 없다. 물리 장애가 사라지는 것이 아니라 데이터 통합 경계를 MCP로 모은다.
 * NL2SQL 스키마는 실행 동작이 아니라 Knowledge이므로 `db://schema` Resource로 분리한다.
 */
@Component
class RetrievalTools(
    private val vectorStore: VectorStore,
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
) {
    private val responseEncoder = ToolResponseEncoder(mapper, MAX_OUTPUT_CHARS)

    @Tool(
        name = "vector_search",
        description = "사내 기술 문서 저장소에서 질문과 의미적으로 유사한 문서를 벡터 검색한다. " +
            "개념 설명, 기술 소개, 정책·가이드 질문에 사용한다.",
    )
    fun vectorSearch(
        @ToolParam(description = "검색할 자연어 질의") query: String,
        @ToolParam(description = "가져올 문서 수 (1~10, 기본 4)", required = false) topK: Int?,
    ): String = guard {
        val k = (topK ?: 4).coerceIn(1, 10)
        val docs = vectorStore.similaritySearch(
            SearchRequest.builder().query(query).topK((k * 2).coerceAtMost(10)).build(),
        ) ?: emptyList()
        docs.sortedByDescending { hybridRetrievalScore(query, it.text.orEmpty(), it.score ?: 0.0) }.take(k).map {
            mapOf(
                "source" to (it.metadata["source"] ?: "unknown"),
                "score" to it.score,
                "text" to it.text,
            )
        }
    }

    @Tool(
        name = "run_sql",
        description = "NL2SQL 경로가 만든 읽기 전용 SELECT SQL 한 문장을 검증·실행하고 결과를 JSON으로 반환한다. " +
            "집계·통계·목록 등 정형 데이터 질문에 사용한다. INSERT/UPDATE/DELETE는 거부된다.",
    )
    fun runSql(
        @ToolParam(description = "실행할 PostgreSQL SELECT 문") sql: String,
    ): String = guard {
        val safe = SqlGuard.sanitize(sql)
        mapOf(
            "executedSql" to safe,
            "rows" to jdbc.queryForList(safe),
        )
    }

    @Tool(
        name = "kg_search",
        description = "온톨로지 기반 지식 그래프에서 엔티티와 관련된 관계(triple)를 조회한다. " +
            "'A와 B의 관계', '무엇을 개발했나' 같은 개체 간 연결 질문에 사용한다.",
    )
    fun kgSearch(
        @ToolParam(description = "관계를 조회할 자연어 질의 또는 엔티티 이름") query: String,
    ): String = guard {
        val rawTokens = query.split(Regex("[\\s,.?!'\"()]+"))
            .map { it.trim() }
            .filter { it.length >= 2 }
            .distinct()
        val entityTokens = rawTokens.filter { token ->
            '-' in token || token.endsWith("팀") || token.endsWith("부") || token.endsWith("부서") ||
                token.endsWith("사업부") || token.any(Char::isUpperCase)
        }
        val tokens = (entityTokens.ifEmpty { rawTokens.filterNot { it in GRAPH_STOP_TOKENS } }).take(4)
        if (tokens.isEmpty()) return@guard emptyList<Any>()

        // 양방향 포함 매칭: 엔티티가 토큰에 포함되는 경우("air는" ⊃ "air")도 잡아
        // 한국어 조사가 붙은 질의에서도 매칭된다.
        val where = tokens.joinToString(" OR ") {
            "subject ILIKE ? OR object ILIKE ? OR ? ILIKE '%' || subject || '%' OR ? ILIKE '%' || object || '%'"
        }
        val params = tokens.flatMap { listOf("%$it%", "%$it%", it, it) }.toTypedArray()
        val direct = jdbc.queryForList(
            "SELECT subject, predicate, object FROM kg_triples WHERE $where LIMIT 30",
            *params,
        )
        // 2홉은 질문이 명시적으로 간접/연쇄 관계를 요구할 때만 확장한다.
        // (예: "Product-D1 관련 프로젝트" → 사용 고객 → 그 고객의 프로젝트)
        val entities = direct.flatMap { listOf(it["subject"] as String, it["object"] as String) }.distinct()
        val requiresExpansion = listOf("2홉", "간접", "연쇄", "거쳐", "연결된 프로젝트").any(query::contains)
        val neighbors =
            if (entities.isEmpty() || !requiresExpansion) emptyList()
            else {
                val inClause = entities.joinToString(",") { "?" }
                jdbc.queryForList(
                    "SELECT subject, predicate, object FROM kg_triples " +
                        "WHERE subject IN ($inClause) OR object IN ($inClause) LIMIT 30",
                    *(entities + entities).toTypedArray(),
                )
            }
        // 직접 매칭을 앞에 배치 (관련도 순) — 총 40개로 제한해 컨텍스트 예산 보호
        (direct + neighbors)
            .distinctBy { "${it["subject"]}|${it["predicate"]}|${it["object"]}" }
            .take(40)
            .map { "${it["subject"]} --[${it["predicate"]}]--> ${it["object"]}" }
    }

    /**
     * 모든 도구의 공통 방어막: 예외를 삼켜 오류 JSON으로 바꾸고(연결 보호),
     * 출력 크기를 제한한다(MCP 스펙의 출력 sanitize 의무 + 컨텍스트 예산 보호).
     */
    private inline fun guard(maxOutputChars: Int = MAX_OUTPUT_CHARS, block: () -> Any): String =
        try {
            responseEncoder.encode(block(), maxOutputChars)
        } catch (e: Exception) {
            responseEncoder.encodeError(e)
        }

    companion object {
        const val MAX_OUTPUT_CHARS = 4000
        private val GRAPH_STOP_TOKENS = setOf(
            "누구", "무엇", "알려줘", "확인해줘", "현재", "실제", "하나", "이상", "제품", "고객사", "직원",
        )
    }
}

/** 벡터 후보를 늘린 뒤 질문 어휘 coverage로 재정렬한다. 별도 튜닝 계수는 두지 않는다. */
internal fun hybridRetrievalScore(query: String, text: String, vectorScore: Double): Double {
    val queryTerms = retrievalTerms(query)
    val textTerms = retrievalTerms(text)
    val coverage = if (queryTerms.isEmpty()) 0.0 else queryTerms.intersect(textTerms).size.toDouble() / queryTerms.size
    return vectorScore.coerceIn(0.0, 1.0) + coverage
}

private fun retrievalTerms(text: String): Set<String> = Regex("[가-힣a-z0-9][가-힣a-z0-9_-]{1,}")
    .findAll(text.lowercase())
    .map { match ->
        val term = match.value
        val suffix = listOf("으로", "에서", "에게", "까지", "부터", "의", "에", "은", "는", "이", "가", "을", "를", "과", "와", "도")
            .firstOrNull { term.length > it.length + 1 && term.endsWith(it) }
        if (suffix == null) term else term.dropLast(suffix.length)
    }
    .filter { it.length >= 2 }
    .toSet()
