package com.riwonace.mcp.tools

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.ai.tool.annotation.Tool
import org.springframework.ai.tool.annotation.ToolParam
import org.springframework.ai.vectorstore.SearchRequest
import org.springframework.ai.vectorstore.VectorStore
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

/**
 * MCP 표준 규격으로 노출되는 데이터 플랫폼 도구 4종.
 * 에이전트는 이 도구들만 알면 되고, DB 접속 정보·임베딩 모델 등
 * 내부 구현은 전혀 알 필요가 없다 (장애 지점 = MCP 연결 1개).
 */
@Component
class RetrievalTools(
    private val vectorStore: VectorStore,
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
) {

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
        val vectorDocs = vectorStore.similaritySearch(
            SearchRequest.builder().query(query).topK(maxOf(k, 10)).build(),
        ) ?: emptyList()

        // Dense 검색만으로 놓치기 쉬운 도메인 용어를 lexical 검색으로 보완한 뒤
        // Reciprocal Rank Fusion으로 결합한다. RRF는 점수 스케일을 맞출 필요 없이
        // 서로 다른 랭킹을 안정적으로 합칠 수 있다 (Cormack et al., SIGIR 2009).
        val lexicalRows = lexicalSearch(query)
        val fused = linkedMapOf<String, FusedDocument>()
        vectorDocs.forEachIndexed { index, document ->
            val source = document.metadata["source"]?.toString() ?: "unknown"
            val key = "$source\u0000${document.text}"
            val candidate = fused.getOrPut(key) {
                FusedDocument(source, document.text, document.score ?: 0.0)
            }
            candidate.rrf += 1.0 / (RRF_K + index + 1)
        }
        lexicalRows.forEachIndexed { index, row ->
            val source = row["source"]?.toString() ?: "unknown"
            val text = row["text"]?.toString().orEmpty()
            val key = "$source\u0000$text"
            val candidate = fused.getOrPut(key) { FusedDocument(source, text, 0.5) }
            candidate.rrf += 1.0 / (RRF_K + index + 1)
        }
        fused.values
            .sortedByDescending { it.rrf }
            .take(k)
            .map { mapOf("source" to it.source, "score" to maxOf(it.score, 0.5), "text" to it.text) }
    }

    private fun lexicalSearch(query: String): List<Map<String, Any>> {
        val tokens = query
            .split(Regex("[\\s,.?!'\"()]+"))
            .map { it.replace(KOREAN_PARTICLE, "").trim() }
            .filter { it.length >= 2 && it !in LEXICAL_STOP_WORDS }
            .distinct()
            .take(6)
        if (tokens.isEmpty()) return emptyList()

        val hits = tokens.joinToString(" + ") { "(CASE WHEN content ILIKE ? THEN 1 ELSE 0 END)" }
        val where = tokens.joinToString(" OR ") { "content ILIKE ?" }
        val params = (tokens + tokens).map { "%$it%" }.toTypedArray()
        return jdbc.queryForList(
            "SELECT metadata->>'source' AS source, content AS text, $hits AS hits " +
                "FROM vector_store WHERE $where ORDER BY hits DESC LIMIT 10",
            *params,
        )
    }

    @Tool(
        name = "get_schema",
        description = "관계형 데이터베이스의 테이블·컬럼 스키마와 카테고리형 컬럼의 실제 값 목록을 조회한다. " +
            "SQL을 작성하기 전에 반드시 호출한다.",
    )
    fun getSchema(): String = guard {
        // kg_triples(kg_search 전용)와 임베딩 테이블은 NL2SQL 스키마에서 제외한다 —
        // 소형 모델은 무관한 테이블이 보이면 테이블을 혼합한 SQL을 생성한다 (벤치마크로 확인)
        val columns = jdbc.queryForList(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name NOT IN ('vector_store', 'kg_triples', 'document_chunks')
            ORDER BY table_name, ordinal_position
            """.trimIndent(),
        )
        val tables = columns.groupBy({ it["table_name"] as String }) {
            "${it["column_name"]} (${it["data_type"]})"
        }
        mapOf("tables" to tables, "valueHints" to valueHints(columns))
    }

    /**
     * 카테고리형(저카디널리티 문자열) 컬럼의 실제 값을 스키마에 동봉한다.
     * 소형 모델은 'dept = 플랫폼팀' 같은 실제 값을 알 수 없으므로,
     * 도메인 지식(K)을 컨텍스트로 제공하는 것이 최대 효용이라는
     * TACC 실증(전현우 외, 2026)을 NL2SQL에 적용한 것이다.
     */
    private fun valueHints(columns: List<Map<String, Any>>): Map<String, List<String>> {
        val hints = linkedMapOf<String, List<String>>()
        columns
            .filter { (it["data_type"] as String).contains("char") }
            .forEach {
                val table = it["table_name"] as String
                val column = it["column_name"] as String
                // 저카디널리티 컬럼만 힌트로 제공 — 값이 많으면 노이즈, 적으면 도메인 지식
                val values = jdbc.queryForList(
                    "SELECT DISTINCT $column FROM $table WHERE $column IS NOT NULL LIMIT ${MAX_HINT_VALUES + 1}",
                    String::class.java,
                )
                if (values.size in 1..MAX_HINT_VALUES) hints["$table.$column"] = values
            }
        return hints
    }

    @Tool(
        name = "run_sql",
        description = "읽기 전용 SELECT SQL 한 문장을 실행하고 결과를 JSON으로 반환한다. " +
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
        val tokens = query.split(Regex("[\\s,.?!'\"()]+"))
            .map { it.trim() }
            .filter { it.length >= 2 }
            .distinct()
            .take(8)
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
        // 2홉 확장: 직접 매칭된 개체의 이웃 관계까지 포함
        // (예: "Product-D1 관련 프로젝트" → 사용 고객 → 그 고객의 프로젝트)
        val entities = direct.flatMap { listOf(it["subject"] as String, it["object"] as String) }.distinct()
        val neighbors =
            if (entities.isEmpty()) emptyList()
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
    private inline fun guard(block: () -> Any): String =
        try {
            val json = mapper.writeValueAsString(block())
            if (json.length > MAX_OUTPUT_CHARS) json.take(MAX_OUTPUT_CHARS) + "\"...(truncated)\"" else json
        } catch (e: Exception) {
            mapper.writeValueAsString(mapOf("error" to (e.message ?: e.javaClass.simpleName)))
        }

    companion object {
        const val MAX_OUTPUT_CHARS = 4000
        const val MAX_HINT_VALUES = 12
        const val RRF_K = 60.0
        val KOREAN_PARTICLE = Regex("(은|는|이|가|을|를|의|에서|으로|로|와|과|도|만|야|이야)$")
        val LEXICAL_STOP_WORDS = setOf(
            "어떻게", "무엇", "되어", "있어", "있었", "있는", "해줘", "알려줘",
            "궁금해", "보여줘", "관련", "내용", "방법", "어디", "누구",
        )
    }

    private data class FusedDocument(
        val source: String,
        val text: String,
        val score: Double,
        var rrf: Double = 0.0,
    )
}
