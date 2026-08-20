package com.riwonace.mcpktor.db

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.sql.Connection
import java.sql.ResultSet
import javax.sql.DataSource

/**
 * Minimal JDBC helper replacing Spring's JdbcTemplate (mcp-server's data-access layer
 * is plain JdbcTemplate with no custom HikariCP tuning -- see application.yml, which has
 * no hikari.* keys -- so this reproduces the same "framework defaults, nothing bespoke"
 * posture using HikariCP directly).
 */
class Database(private val dataSource: DataSource) {

    fun <T> queryForList(sql: String, vararg args: Any?, mapper: (ResultSet) -> T): List<T> =
        withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                bindArgs(stmt, args)
                stmt.executeQuery().use { rs ->
                    val out = mutableListOf<T>()
                    while (rs.next()) out += mapper(rs)
                    out
                }
            }
        }

    /** Mirrors JdbcTemplate.queryForList(sql, *args): rows as column-name -> value maps. */
    fun queryForRowMaps(sql: String, vararg args: Any?): List<Map<String, Any?>> =
        withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                bindArgs(stmt, args)
                stmt.executeQuery().use { rs ->
                    val meta = rs.metaData
                    val columnCount = meta.columnCount
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) {
                        val row = LinkedHashMap<String, Any?>(columnCount)
                        for (i in 1..columnCount) {
                            row[meta.getColumnLabel(i)] = rs.getObject(i)
                        }
                        out += row
                    }
                    out
                }
            }
        }

    fun queryForStringList(sql: String): List<String> =
        withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    val out = mutableListOf<String>()
                    while (rs.next()) out += rs.getString(1)
                    out
                }
            }
        }

    fun queryForLong(sql: String): Long =
        withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                stmt.executeQuery().use { rs ->
                    if (rs.next()) rs.getLong(1) else 0L
                }
            }
        }

    fun update(sql: String, vararg args: Any?): Int =
        withConnection { conn ->
            conn.prepareStatement(sql).use { stmt ->
                bindArgs(stmt, args)
                stmt.executeUpdate()
            }
        }

    private fun bindArgs(stmt: java.sql.PreparedStatement, args: Array<out Any?>) {
        args.forEachIndexed { index, arg -> stmt.setObject(index + 1, arg) }
    }

    private fun <T> withConnection(block: (Connection) -> T): T =
        dataSource.connection.use { conn -> block(conn) }

    companion object {
        fun hikari(jdbcUrl: String, username: String, password: String): Database {
            val config = HikariConfig().apply {
                this.jdbcUrl = jdbcUrl
                this.username = username
                this.password = password
                driverClassName = "org.postgresql.Driver"
            }
            return Database(HikariDataSource(config))
        }
    }
}
