package com.riwonace.mcp.ingest

import org.springframework.ai.document.Document
import org.springframework.ai.vectorstore.VectorStore
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.io.File

/**
 * 벡터 저장소 적재를 수동으로 실행하는 운영용 API.
 *
 * 파일시스템 경로를 받는 `/admin` 엔드포인트이므로 운영 환경에서는 접근 제어가 필요하다.
 */
@RestController
@RequestMapping("/admin")
class IngestController(
    private val ingestor: DataIngestor,
    private val vectorStore: VectorStore,
) {

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
    fun ingestDirectory(@RequestParam path: String): Map<String, Any> {
        val dir = File(path)
        if (!dir.isDirectory) return mapOf("error" to "디렉토리가 아닙니다: $path")
        val files = dir.listFiles { f -> f.extension == "md" && !f.name.equals("README.md", true) }
            .orEmpty()
            .sortedBy { it.name }
        val docs = files.map { f ->
            Document(f.readText(Charsets.UTF_8), mutableMapOf<String, Any>("source" to f.name))
        }
        if (docs.isNotEmpty()) vectorStore.add(docs)
        return mapOf("ingested" to docs.size, "files" to files.map { it.name })
    }
}
