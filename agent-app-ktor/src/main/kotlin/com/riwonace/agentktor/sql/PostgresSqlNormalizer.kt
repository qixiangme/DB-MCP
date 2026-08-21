package com.riwonace.agentktor.sql


/** 소형 모델이 섞어 쓰는 보편적인 SQL 방언 표기를 PostgreSQL 문법으로 제한적으로 정규화한다. */
class PostgresSqlNormalizer {
    fun normalize(sql: String): String = sql.replace('`', '"')
}
