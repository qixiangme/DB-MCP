package com.riwonace.agent.decomposition

import org.slf4j.LoggerFactory
import org.springframework.ai.chat.client.ChatClient
import org.springframework.stereotype.Component

/**
 * IRCoT (Interleaving Retrieval with Chain-of-Thought) 영감의 질문 분해기.
 *
 * 복잡한 질문을 하위 질문으로 분해하여 순차적 검색-추론을 가능하게 한다.
 * 논문 참고: https://arxiv.org/abs/2212.10509 (Trivedi et al., 2023)
 *
 * 예시:
 * - 입력: "Client-A가 사용하는 제품의 카테고리는?"
 * - 분해 결과:
 *   1. "Client-A가 사용하는 제품은?" → Product-C1
 *   2. "Product-C1의 카테고리는?" → cloud
 */
@Component
class QueryDecomposer(
    private val chatClient: ChatClient,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * 질문이 멀티홉인지 판단하고, 멀티홉이면 하위 질문 목록을 반환한다.
     *
     * @return 단일 질문이면 원본 질문만 포함한 리스트, 멀티홉이면 분해된 질문 리스트
     */
    fun decompose(question: String): List<String> {
        // 1단계: 멀티홉 여부 판단
        if (!isMultiHopQuestion(question)) {
            log.debug("단일 질문으로 판단: {}", question)
            return listOf(question)
        }

        // 2단계: 하위 질문 분해
        val subQuestions = decomposeToSubQuestions(question)
        log.info("멀티홉 질문 분해: {} → {}", question, subQuestions)
        return subQuestions
    }

    /**
     * 멀티홉 질문 패턴을 탐지한다.
     * 패턴: "A의 B", "A가 ~하는 B", "A를 ~하는 B" 등 관계 추적이 필요한 질문
     */
    private fun isMultiHopQuestion(question: String): Boolean {
        val multiHopPatterns = listOf(
            // 소유/관계 추적: "A의 B의 C"
            Regex(".+의\\s+.+의\\s+.+"),
            // 동사 체인: "A가 사용하는 B의 C"
            Regex(".+(가|이|를|을)\\s+.+(하는|한|사용하는|담당하는|속한|포함된)\\s+.+의\\s+.+"),
            // 간접 관계: "A 팀 직원들이 담당하는 고객"
            Regex(".+(팀|부서)\\s+.+(직원|사람)들?이?\\s+(담당|관리|진행)"),
            // 멀티 엔티티 관계: "A와 관련된 B 중에서 C"
            Regex(".+(와|과)\\s+관련된?.+중"),
        )

        return multiHopPatterns.any { it.containsMatchIn(question) }
    }

    /**
     * LLM을 사용하여 질문을 하위 질문으로 분해한다.
     */
    private fun decomposeToSubQuestions(question: String): List<String> {
        val raw = chatClient.prompt()
            .system(
                """너는 질문 분해 전문가다. 복잡한 질문을 단순한 하위 질문들로 분해한다.

규칙:
1. 각 하위 질문은 한 번의 검색으로 답할 수 있어야 한다
2. 하위 질문들은 순서대로 해결해야 하며, 앞 질문의 답이 뒤 질문에 사용된다
3. 최대 3개의 하위 질문으로 분해한다
4. 각 질문은 한 줄에 하나씩, 번호 없이 출력한다

예시1:
입력: "Client-A가 사용하는 제품의 카테고리는?"
출력:
Client-A가 사용하는 제품은?
그 제품의 카테고리는?

예시2:
입력: "기술지원팀 직원들이 담당하는 고객사 목록은?"
출력:
기술지원팀 직원들은 누구야?
그 직원들이 담당하는 고객사는?"""
            )
            .user("입력: $question\n출력:")
            .call()
            .content()
            .orEmpty()

        val subQuestions = raw.lines()
            .map { it.trim() }
            .filter { it.isNotBlank() && !it.startsWith("입력:") && !it.startsWith("출력:") }
            .take(3)

        return if (subQuestions.size > 1) subQuestions else listOf(question)
    }

    /**
     * 이전 질문의 답변을 다음 질문에 통합한다.
     */
    fun integrateContext(nextQuestion: String, previousAnswer: String): String {
        // "그 제품" 등의 대명사를 실제 값으로 치환
        val pronounPatterns = listOf(
            Regex("그\\s*(제품|고객|직원|프로젝트|부서|팀)") to previousAnswer,
            Regex("이\\s*(제품|고객|직원|프로젝트|부서|팀)") to previousAnswer,
            Regex("해당\\s*(제품|고객|직원|프로젝트|부서|팀)") to previousAnswer,
        )

        var result = nextQuestion
        for ((pattern, replacement) in pronounPatterns) {
            result = result.replace(pattern, replacement)
        }

        // 대명사 치환이 안 됐으면 컨텍스트를 앞에 추가
        return if (result == nextQuestion && previousAnswer.isNotBlank()) {
            "($previousAnswer 관련) $nextQuestion"
        } else {
            result
        }
    }
}
