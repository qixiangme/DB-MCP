package com.riwonace.mcpktor.tools

import com.fasterxml.jackson.databind.ObjectMapper
import com.pgvector.PGvector
import com.riwonace.mcpktor.db.Database
import com.riwonace.mcpktor.embedding.OllamaEmbedder
import org.slf4j.LoggerFactory

/**
 * Ports com.riwonace.mcp.tools.RetrievalTools 1:1: same 3 tools (vector_search, run_sql,
 * kg_search), same guards, same output shapes. Only the data-access layer differs --
 * Spring AI's VectorStore abstraction is replaced with a direct pgvector query (see
 * README for the exact SQL, confirmed against spring-ai-pgvector-store 1.0.3's
 * bytecode: cosine distance via `<=>`, score = 1 - distance, similarityThreshold
 * defaults to 0.0 i.e. accept-all) and JdbcTemplate is replaced with [Database].
 */
class RetrievalTools(
    private val db: Database,
    private val embedder: OllamaEmbedder,
    private val mapper: ObjectMapper,
) {
    private val responseEncoder = ToolResponseEncoder(mapper, MAX_OUTPUT_CHARS)
    private val log = LoggerFactory.getLogger(RetrievalTools::class.java)

    fun vectorSearch(query: String, topK: Int?): String = guard {
        val k = (topK ?: 4).coerceIn(1, 10)
        val limit = (k * 5).coerceAtMost(20)
        val embedding = embedder.embed(query)
        val vector = PGvector(embedding.map { it.toFloat() }.toFloatArray())

        data class Candidate(val source: String, val score: Double, val text: String)

        val candidates = db.queryForList(
            "SELECT content, metadata, embedding <=> ? AS distance FROM vector_store " +
                "WHERE embedding <=> ? < ? ORDER BY distance LIMIT ?",
            vector, vector, 1.0, limit,
        ) { rs ->
            val content = rs.getString("content") ?: ""
            val metadataRaw = rs.getString("metadata")
            val source = metadataRaw?.let { metadataMapOrNull(it)?.get("source") as? String } ?: "unknown"
            val distance = rs.getDouble("distance")
            Candidate(source, 1.0 - distance, content)
        }

        candidates
            .sortedWith(
                compareByDescending<Candidate> { lexicalCoverage(query, it.text) }
                    .thenByDescending { it.score },
            )
            .take(k)
            .map { mapOf("source" to it.source, "score" to it.score, "text" to it.text) }
    }

    private fun metadataMapOrNull(json: String): Map<String, Any?>? = try {
        mapper.readValue(
            json,
            mapper.typeFactory.constructMapType(Map::class.java, String::class.java, Any::class.java),
        )
    } catch (_: Exception) {
        null
    }

    fun runSql(sql: String): String = guard {
        val safe = SqlGuard.sanitize(sql)
        mapOf(
            "executedSql" to safe,
            "rows" to db.queryForRowMaps(safe),
        )
    }

    fun kgSearch(query: String): String = guard {
        log.info("[kg_search] query='$query'")
        val rawTokens = query.split(Regex("[\\s,.?!'\"()]+"))
            .map { it.trim() }
            .filter { it.length >= 2 }
            .map { token ->
                val suffixes = listOf("은", "는", "이", "가", "을", "를", "의", "에", "에서", "으로", "로", "와", "과", "도")
                suffixes.fold(token) { acc, suffix ->
                    if (acc.length > suffix.length + 2 && acc.endsWith(suffix)) acc.dropLast(suffix.length) else acc
                }
            }
            .distinct()
        val entityTokens = rawTokens.filter { token ->
            '-' in token || token.endsWith("팀") || token.endsWith("부") || token.endsWith("부서") ||
                token.endsWith("사업부") || token.any(Char::isUpperCase)
        }
        val matchedPredicates = PREDICATE_KEYWORDS.filter { (korean, _) -> query.contains(korean) }
            .map { it.second }
        val tokens = (entityTokens.ifEmpty { rawTokens.filterNot { it in GRAPH_STOP_TOKENS } }).take(4)
        log.info("[kg_search] rawTokens=$rawTokens, entityTokens=$entityTokens, tokens=$tokens, matchedPredicates=$matchedPredicates")

        if (tokens.isEmpty() && matchedPredicates.isEmpty()) {
            log.info("[kg_search] Early return: no tokens and no predicates")
            return@guard emptyList<Any>()
        }

        val tokenWhere = if (tokens.isNotEmpty()) {
            tokens.joinToString(" OR ") {
                "subject ILIKE ? OR object ILIKE ? OR ? ILIKE '%' || subject || '%' OR ? ILIKE '%' || object || '%'"
            }
        } else null
        val predicateWhere = if (matchedPredicates.isNotEmpty()) {
            matchedPredicates.joinToString(" OR ") { "predicate = ?" }
        } else null
        val hasSpecificEntity = entityTokens.isNotEmpty()
        val where = if (hasSpecificEntity && predicateWhere != null) {
            "($tokenWhere) AND ($predicateWhere)"
        } else {
            listOfNotNull(tokenWhere, predicateWhere).joinToString(" OR ")
        }
        val tokenParams = tokens.flatMap { listOf("%$it%", "%$it%", it, it) }
        val predicateParams = matchedPredicates
        val params = (tokenParams + predicateParams).toTypedArray()
        log.info("[kg_search] SQL WHERE: $where")
        log.info("[kg_search] SQL params: ${params.toList()}")

        val direct = db.queryForRowMaps(
            "SELECT subject, predicate, object FROM kg_triples WHERE $where LIMIT 30",
            *params,
        )
        log.info("[kg_search] direct results: ${direct.size}")

        val entities = direct.flatMap { listOf(it["subject"] as String, it["object"] as String) }.distinct()
        val requiresExpansion = listOf("2홉", "간접", "연쇄", "거쳐", "연결된 프로젝트").any(query::contains)
        val neighbors =
            if (entities.isEmpty() || !requiresExpansion) emptyList()
            else {
                val inClause = entities.joinToString(",") { "?" }
                db.queryForRowMaps(
                    "SELECT subject, predicate, object FROM kg_triples " +
                        "WHERE subject IN ($inClause) OR object IN ($inClause) LIMIT 30",
                    *(entities + entities).toTypedArray(),
                )
            }

        (direct + neighbors)
            .distinctBy { "${it["subject"]}|${it["predicate"]}|${it["object"]}" }
            .take(40)
            .map { "${it["subject"]} --[${it["predicate"]}]--> ${it["object"]}" }
    }

    private inline fun guard(maxOutputChars: Int = MAX_OUTPUT_CHARS, block: () -> Any): String =
        try {
            responseEncoder.encode(block(), maxOutputChars)
        } catch (e: Exception) {
            responseEncoder.encodeError(e)
        }

    companion object {
        const val MAX_OUTPUT_CHARS = 4000
        private val GRAPH_STOP_TOKENS = setOf(
            "누구", "무엇", "알려줘", "확인해줘", "현재", "실제", "하나", "이상",
        )
        private val PREDICATE_KEYWORDS = setOf(
            "담당" to "담당한다",
            "사용" to "사용한다",
            "소속" to "소속",
            "이끈" to "이끈다",
            "이끌" to "이끈다",
            "보고" to "이슈보고",
            "팀장" to "부서장",
            "진행" to "프로젝트",
        )
    }
}

/** 벡터 후보군 안에서 질문 어휘 coverage를 우선하고, 동률일 때 벡터 점수를 사용한다. */
internal fun lexicalCoverage(query: String, text: String): Double {
    val queryTerms = retrievalTerms(query)
    val textTerms = retrievalTerms(text)
    return if (queryTerms.isEmpty()) 0.0 else queryTerms.intersect(textTerms).size.toDouble() / queryTerms.size
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
