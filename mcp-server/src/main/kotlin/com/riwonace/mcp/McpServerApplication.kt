package com.riwonace.mcp

import org.springframework.ai.tool.ToolCallbackProvider
import org.springframework.ai.tool.method.MethodToolCallbackProvider
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import com.riwonace.mcp.tools.RetrievalTools

@SpringBootApplication
class McpServerApplication {

    @Bean
    fun riwonaceTools(retrievalTools: RetrievalTools): ToolCallbackProvider =
        MethodToolCallbackProvider.builder()
            .toolObjects(retrievalTools)
            .build()
}

fun main(args: Array<String>) {
    runApplication<McpServerApplication>(*args)
}
