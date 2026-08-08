# AIR 전환 실험 판정 — Spring AI 유지

## 결론

현재 `main` (`55cbc9b570094b30026fb4f36bd44c620711d1bd`)에서는 **Spring AI MCP 서버를
기본 구현으로 유지**한다. AIR exact 구현은 88개 질문에서 Spring AI와 문항별 정답 O/X가
완전히 같았지만 정확도 이득이 없었고, 한 번의 120초 도구 타임아웃이 발생했다. 정상 응답의
지연은 사실상 동률이므로 별도 런타임과 공급망을 추가할 전환 이득이 확인되지 않았다.

AIR 구현은 MCP 교체 가능성을 검증하는 선택형 참조 구현으로 남긴다. 이 실험 PR은 결과를
보존한 뒤 병합하지 않고 닫는 것이 벤치마크 정책에 맞다.

## 공통 조건

| 항목 | 값 |
|---|---|
| 측정 시각 | 2026-08-09 (Asia/Seoul) |
| 에이전트 | 동일한 `agent-app`, Spring AI MCP client |
| 모델 | Ollama `gemma3:1b`, temperature 0 |
| 임베딩 | `nomic-embed-text`, 768차원 |
| 데이터 | 동일 PostgreSQL, vector 50건, graph triple 354건 |
| 검색 | 양쪽 모두 pgvector exact cosine, top-k 4 |
| 풀/타임아웃 | DB pool 10, MCP request/tool timeout 120초 |
| 실행 순서 | 문항마다 Spring AI/AIR 순서를 교대 |
| 반복 | 방향성 판정을 위한 1회; 일반화 주장은 반복 3회 이상 필요 |

AIR에만 있던 하이브리드 RRF는 `VECTOR_SEARCH_MODE=hybrid` 선택 옵션으로 격리했다. 따라서
아래 수치는 프레임워크 외 검색 알고리즘을 통제한 비교다.

## 결과

| 평가셋 | 구현 | 답변 정확도 | 라우팅 | 평균 지연 | 중앙값 | 특이사항 |
|---|---|---:|---:|---:|---:|---|
| 공식 30 | Spring AI | 23.3% | 100% | 1,786ms | 1,403ms | 오류 없음 |
| 공식 30 | AIR exact | 23.3% | 100% | 5,609ms | 1,632ms | V8 도구 호출 120,455ms |
| parity 개발 18 | Spring AI | 50.0% | 100% | 1,289ms | 1,032ms | 오류 없음 |
| parity 개발 18 | AIR exact | 50.0% | 100% | 1,267ms | 1,014ms | 오류 없음 |
| 종합 개발 40 | Spring AI | 25.0% | 72.5% | 1,419ms | 972ms | 오류 없음 |
| 종합 개발 40 | AIR exact | 25.0% | 72.5% | 1,379ms | 1,252ms | 오류 없음 |
| **합계 88** | **Spring AI** | **29.5% (26/88)** | **87.5% (77/88)** | **1,517ms** | **1,209ms** | p95 3,011ms, timeout 0 |
| **합계 88** | **AIR exact** | **29.5% (26/88)** | **87.5% (77/88)** | **2,798ms** | **1,252ms** | p95 2,911ms, timeout 1 |

- 답변 판정 불일치: 0/88
- 라우팅 판정 불일치: 0/88
- 문항별 지연: AIR가 빠른 문항 46개, Spring AI가 빠른 문항 42개
- 문항별 `AIR - Spring AI` 지연 중앙값: -46ms

정상 경로의 지연 차이는 호출 순서와 Ollama 열 상태보다 작다. AIR 평균이 큰 이유는 V8의
단일 120초 timeout이다. 따라서 “AIR가 일반적으로 느리다”가 아니라 “평상시 성능은 동률이나
이번 측정에서 AIR에만 긴 꼬리 지연이 관측됐다”가 정확한 해석이다.

원시 결과:

- `eval/results/air-spring-parity-main-55cbc9b.json`
- `eval/results/air-spring-parity-expanded-main-55cbc9b.json`
- `eval/results/air-spring-comprehensive-main-55cbc9b.json`

## 데이터셋 보강과 감사 결과

다른 작업 브랜치의 확장 평가를 검토해 다음을 반영했다.

- `comprehensive-eval.json`: factual, aggregation, multi-hop, negation, comparison, temporal,
  ambiguous, document 각 5문항으로 총 40문항을 유지했다.
- 숫자 하나만 있어도 통과하던 `numeric` 채점을 실제 정답 숫자와 비교하는
  `exactNumeric`으로 교체했다.
- 반대 결론도 통과하던 비교 문항, 상대 시점인 “이번 달”, 무관한 제품명으로 통과하던
  부정형 문항을 실제 DB ground truth에 맞게 수정했다.
- 공개 커밋에 포함된 `holdout-eval.json`은 더 이상 숨은 보류셋이 아니므로 포함하지 않았다.
- `framework-parity-eval.json`: 기존 공식셋과 겹치지 않는 SQL/VECTOR/GRAPH 각 6문항을
  추가했다.

종합셋은 두 서버 공통의 더 큰 병목도 찾았다. `월 구독료`, `고객 지역`, `지역별 고객사 수`
같은 질문이 규칙 라우터의 어휘 공백으로 잘못 라우팅되며, multi-hop과 ambiguous 답변 정확도는
양쪽 모두 0%였다. 이는 MCP 서버 프레임워크를 바꿔 해결할 문제가 아니다.

아직 필요한 후속 평가는 동시성 부하, 서버 cold start/RSS, MCP 도구 직접 계약 테스트,
AIR timeout 재현, 구현을 동결한 뒤 별도로 관리하는 비공개 보류셋이다.

## 장단점

| 관점 | Spring AI | AIR |
|---|---|---|
| 정확도/라우팅 | AIR와 동일 | Spring AI와 동일 |
| 꼬리 지연 | 이번 88문항 timeout 0 | 이번 88문항 timeout 1 |
| 통합 | Kotlin/Gradle, 적재, pgvector, MCP client/server가 한 생태계 | Node 런타임과 npm 운영이 추가됨 |
| 구현량/기동 | 코드와 기동 비용이 더 큼 | 단일 서버 파일, 기동이 빠르고 플러그인 구성이 간단 |
| 타입/테스트 | Kotlin 타입과 기존 JUnit 자산 | 도구 파라미터 자동 검증, 새 Node 테스트 자산 필요 |
| 공급망 | 기존 프로젝트 의존성 안에 포함 | 현재 `npm audit`: high 2, moderate 3 (전이 의존성) |
| 기능 범위 | 데이터 적재까지 담당하는 기본 구현 | 적재 미지원, Spring AI 적재를 선행해야 함 |

## 재검토 게이트

다음 조건을 모두 만족할 때만 AIR 기본 전환을 다시 검토한다.

1. AIR의 120초 vector timeout을 재현하고 원인을 제거한다.
2. high 보안 권고 0건 또는 비영향 근거를 남긴다.
3. 공식·확장·비공개 보류셋을 각각 3회 이상 교대 실행한다.
4. 정확도 비열등(문항 기준 회귀 0건)과 timeout 0건을 만족한다.
5. cold start/RSS/동시성 중 하나에서 운영상 유의미한 우위를 수치로 증명한다.
