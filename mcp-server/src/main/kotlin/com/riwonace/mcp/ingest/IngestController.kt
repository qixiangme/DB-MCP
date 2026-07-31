package com.riwonace.mcp.ingest

import org.springframework.ai.document.Document
import org.springframework.ai.vectorstore.VectorStore
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.io.File

@RestController
@RequestMapping("/admin")
class IngestController(
    private val ingestor: DataIngestor,
    private val vectorStore: VectorStore,
) {

    @PostMapping("/ingest")
    fun ingest(): Map<String, Any> {
        val ingested = ingestor.ingestIfEmpty()
        return mapOf("ingested" to ingested)
    }

    /** 디렉토리의 마크다운 문서를 임베딩해 벡터 저장소에 적재한다 (파일당 문서 1건). */
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
