package com.riwonace.agent.answer

import com.riwonace.agent.context.ContextItem
import com.riwonace.agent.router.Route
import org.springframework.stereotype.Component

/**
 * 추출 가이드 프롬프트 (Extraction-Guided Prompting).
 *
 * 소형 모델이 "근거→정답" 변환에 실패하는 문제를 해결한다:
 * 1. 라우트별 맞춤 프롬프트로 추출 전략을 명시
 * 2. Few-shot 예시로 성공적인 추출 패턴 학습 유도
 * 3. 긍정적 지시어로 과도한 보수성 완화
 *
 * 실험 근거:
 * - 기존 프롬프트: VECTOR 20% 정확도 (문서가 있어도 "찾을 수 없습니다" 응답)
 * - 개선 목표: 관련 정보가 있으면 반드시 추출
 */
@Component
class ExtractionGuidedPrompt {

    /**
     * 라우트별 최적화된 시스템 프롬프트를 생성한다.
     */
    fun buildSystemPrompt(routes: List<Route>): String {
        val primary = routes.firstOrNull() ?: Route.VECTOR
        return when (primary) {
            Route.VECTOR -> VECTOR_SYSTEM_PROMPT
            Route.SQL -> SQL_SYSTEM_PROMPT
            Route.GRAPH -> GRAPH_SYSTEM_PROMPT
        }
    }

    /**
     * 컨텍스트와 질문을 결합한 사용자 프롬프트를 생성한다.
     * Few-shot 예시를 포함하여 추출 패턴을 학습시킨다.
     */
    fun buildUserPrompt(
        question: String,
        context: List<ContextItem>,
        routes: List<Route>,
    ): String {
        val contextBlock = if (context.isEmpty()) {
            "(검색된 컨텍스트 없음)"
        } else {
            context.joinToString("\n\n---\n\n") { item ->
                "【${item.source}】\n${item.text}"
            }
        }

        val primary = routes.firstOrNull() ?: Route.VECTOR
        val fewShot = when (primary) {
            Route.VECTOR -> VECTOR_FEW_SHOT
            Route.SQL -> ""  // SQL은 GroundedAnswerRenderer가 처리
            Route.GRAPH -> GRAPH_FEW_SHOT
        }

        return buildString {
            if (fewShot.isNotBlank()) {
                append("## 답변 예시\n")
                append(fewShot)
                append("\n\n")
            }
            append("## 제공된 컨텍스트\n")
            append(contextBlock)
            append("\n\n## 질문\n")
            append(question)
        }
    }

    companion object {
        /**
         * VECTOR 라우트 전용 시스템 프롬프트.
         *
         * 핵심 변경:
         * 1. "관련 정보가 있으면 반드시 추출하라" (긍정적 지시)
         * 2. 추출 전략 명시 (숫자, 이름, 절차 등)
         * 3. 보수적 거부 조건 완화
         */
        private val VECTOR_SYSTEM_PROMPT = """
            |너는 리원에이스 데이터 플랫폼의 문서 검색 AI다.
            |
            |## 핵심 원칙
            |제공된 컨텍스트에서 질문과 관련된 정보를 반드시 추출하여 답변하라.
            |
            |## 추출 전략
            |1. 숫자/수량: 문서에 언급된 구체적인 숫자를 그대로 인용
            |2. 이름/명칭: 제품명, 서비스명, 기술명을 정확히 추출
            |3. 절차/방법: 단계별 설명이 있으면 요약하여 제시
            |4. 설정값: 권장 설정, 파라미터 값을 구체적으로 명시
            |
            |## 답변 형식
            |- 질문에 직접 대응하는 핵심 정보를 먼저 제시
            |- 끝에 [출처: 파일명] 표기
            |- 정말로 관련 정보가 없을 때만 "제공된 데이터에서 찾을 수 없습니다"
            |
            |## 주의
            |문서에 관련 내용이 조금이라도 있으면 추출하여 답변하라.
            |"찾을 수 없습니다"는 정말로 무관한 문서만 있을 때 사용한다.
        """.trimMargin()

        /**
         * VECTOR Few-shot 예시.
         * 컨텍스트에서 정보를 추출하는 성공 패턴을 보여준다.
         */
        private val VECTOR_FEW_SHOT = """
            |예시 1)
            |컨텍스트: 【DOC-019.md】DB 최적화 - Connection Pool: 최소 14, 최대 52. 인덱스 점검: 월 1회.
            |질문: DB 튜닝 방법 알려줘
            |답변: DB 최적화 방법은 다음과 같습니다.
            |- Connection Pool: 최소 14, 최대 52 설정
            |- 인덱스 점검: 슬로우 쿼리 로그 기반으로 월 1회 점검
            |[출처: DOC-019.md]
            |
            |예시 2)
            |컨텍스트: 【DOC-011.md】Product-C1 설치 - Docker와 Docker Compose 필요. Helm 차트로 배포 가능.
            |질문: Product-C1 설치 방법은?
            |답변: Product-C1 설치 방법입니다.
            |- Docker와 Docker Compose 설치 필요
            |- Kubernetes 환경에서는 Helm 차트로 배포 가능
            |[출처: DOC-011.md]
        """.trimMargin()

        private val SQL_SYSTEM_PROMPT = """
            |너는 리원에이스 데이터 플랫폼의 SQL 분석 AI다.
            |
            |## 핵심 원칙
            |SQL 조회 결과를 질문에 맞게 자연어로 설명하라.
            |
            |## 답변 형식
            |- 조회된 데이터를 질문의 맥락에 맞게 해석
            |- 숫자는 명확히 표기
            |- 끝에 [출처: sql] 표기
        """.trimMargin()

        private val GRAPH_SYSTEM_PROMPT = """
            |너는 리원에이스 데이터 플랫폼의 지식 그래프 AI다.
            |
            |## 핵심 원칙
            |엔티티 간의 관계를 명확하게 설명하라.
            |
            |## 답변 형식
            |- 질문에서 언급된 엔티티와 관련된 관계를 나열
            |- A --[관계]--> B 형식의 정보를 자연어로 변환
            |- 끝에 [출처: knowledge-graph] 표기
        """.trimMargin()

        private val GRAPH_FEW_SHOT = """
            |예시)
            |컨텍스트: 【knowledge-graph】Client-A --[계약]--> Product-D1, Product-D1 --[개발팀]--> 플랫폼팀
            |질문: Client-A가 사용하는 제품은?
            |답변: Client-A는 Product-D1을 사용하고 있습니다.
            |[출처: knowledge-graph]
        """.trimMargin()
    }
}
