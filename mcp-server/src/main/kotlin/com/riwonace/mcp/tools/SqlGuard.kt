package com.riwonace.mcp.tools

/**
 * NL2SQL로 생성된 SQL을 실행 전에 검증하는 읽기 전용 가드.
 * LLM이 생성한 SQL은 신뢰할 수 없으므로 SELECT 단일 문장만 허용한다.
 */
object SqlGuard {

    private val FORBIDDEN = Regex(
        "\\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy|vacuum|do|call|execute|merge|set|pg_sleep)\\b",
        RegexOption.IGNORE_CASE,
    )
    private val SELECT_ONLY = Regex("^\\s*(select|with)\\b", RegexOption.IGNORE_CASE)
    private const val DEFAULT_LIMIT = 50

    /**
     * 검증에 성공하면 실행 가능한 SQL(LIMIT 보강 포함)을 반환하고,
     * 실패하면 IllegalArgumentException을 던진다.
     */
    fun sanitize(rawSql: String): String {
        var sql = rawSql.trim().removeSuffix(";").trim()

        require(sql.isNotBlank()) { "SQL이 비어 있습니다." }
        require(!sql.contains(";")) { "복수 문장 SQL은 허용되지 않습니다." }
        require(!sql.contains("--") && !sql.contains("/*")) { "주석이 포함된 SQL은 허용되지 않습니다." }
        require(SELECT_ONLY.containsMatchIn(sql)) { "SELECT(또는 WITH ... SELECT) 문만 실행할 수 있습니다." }
        require(!FORBIDDEN.containsMatchIn(sql)) { "읽기 전용 정책상 허용되지 않는 키워드가 포함되어 있습니다." }

        if (!Regex("\\blimit\\b", RegexOption.IGNORE_CASE).containsMatchIn(sql)) {
            sql = "$sql LIMIT $DEFAULT_LIMIT"
        }
        return sql
    }
}
