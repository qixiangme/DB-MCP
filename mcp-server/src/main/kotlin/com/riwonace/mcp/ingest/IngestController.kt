package com.riwonace.mcp.ingest

import org.slf4j.LoggerFactory
import org.springframework.ai.document.Document
import org.springframework.ai.vectorstore.VectorStore
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.io.File
import java.nio.file.Paths

/**
 * 벡터 저장소 적재를 수동으로 실행하는 운영용 API.
 *
 * 파일시스템 경로를 받는 `/admin` 엔드포인트이므로 운영 환경에서는 접근 제어가 필요하다.
 *
 * 보안 강화:
 * - 경로 정규화로 상위 디렉토리 탈출(../) 방지
 * - 심볼릭 링크를 통한 범위 탈출 방지
 * - 허용된 루트 디렉토리 내에서만 작동
 */
@RestController
@RequestMapping("/admin")
class IngestController(
    private val ingestor: DataIngestor,
    private val vectorStore: VectorStore,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** 허용된 루트 디렉토리 (프로젝트 디렉토리 기준) */
    private val allowedRoot: String by lazy {
        Paths.get(System.getProperty("user.dir")).toAbsolutePath().toString()
    }

    /** 벡터 저장소가 비어 있을 때만 기본 문서를 적재하고, 추가된 문서 수를 반환한다. */
    @PostMapping("/ingest")
    fun ingest(): Map<String, Any> {
        val ingested = ingestor.ingestIfEmpty()
        return mapOf("ingested" to ingested)
    }

    /**
     * 지정한 디렉토리의 README를 제외한 마크다운 파일을 파일당 문서 1건으로 적재한다.
     * 이 작업은 기존 파일과의 중복 여부를 검사하지 않으므로 호출자가 재실행 여부를 관리해야 한다.
     */
    @PostMapping("/ingest-dir")
    fun ingestDirectory(@RequestParam path: String): Map<String, Any?> {
        return try {
            val sanitizedPath = validateAndSanitizePath(path)
            val dir = File(sanitizedPath)

            if (!dir.isDirectory) {
                return mapOf("error" to "디렉토리가 아닙니다.")
            }
            if (!dir.canRead()) {
                return mapOf("error" to "읽기 권한이 없습니다.")
            }

            val files = dir.listFiles { f ->
                f.isFile && f.extension == "md" && !f.name.equals("README.md", true)
            }.orEmpty().sortedBy { it.name }

            val docs = files.map { f ->
                Document(f.readText(Charsets.UTF_8), mutableMapOf<String, Any>("source" to f.name))
            }

            if (docs.isNotEmpty()) vectorStore.add(docs)
            log.info("디렉토리 임베딩 완료: {} 파일", docs.size)

            mapOf("ingested" to docs.size, "files" to files.map { it.name })
        } catch (e: SecurityException) {
            log.warn("경로 접근 거부: {}", e.message)
            mapOf("error" to e.message)
        } catch (e: Exception) {
            log.error("디렉토리 임베딩 실패", e)
            mapOf("error" to "내부 오류가 발생했습니다.")
        }
    }

    /**
     * 경로를 검증하고 정규화한다.
     * @throws SecurityException 허용 범위를 벗어난 경로일 경우
     */
    private fun validateAndSanitizePath(path: String): String {
        // 경로 정규화
        val requestedPath = Paths.get(path).toAbsolutePath().normalize()

        // 허용 루트 내에 있는지 확인
        if (!requestedPath.toString().startsWith(allowedRoot)) {
            throw SecurityException("허용된 디렉토리 범위를 벗어났습니다.")
        }

        // 심볼릭 링크 확인 (canonical path로 실제 경로 확인)
        val file = File(path)
        val canonicalPath = file.canonicalPath
        if (!canonicalPath.startsWith(allowedRoot)) {
            throw SecurityException("심볼릭 링크를 통한 범위 탈출이 탐지되었습니다.")
        }

        return canonicalPath
    }
}
