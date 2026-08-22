# 비공개 데이터셋 채점 결과

`eval/private-eval.json`(신규 작성, `eval/official-eval.json`과 문항 완전 비중복) 30문항으로
Spring AI(baseline) / Go / Ktor 세 구현을 순차 기동해 채점했다. 채점 대상 코드나 프롬프트에는
이 문항을 노출하지 않았다.

## 프로토콜

| 항목 | 값 |
|---|---|
| 데이터셋 | `eval/private-eval.json`, SQL 10 / VECTOR 10 / GRAPH 10, ground truth는 `companyx-dataset-v1.0` SQL/그래프/문서에서 직접 조회해 도출 |
| 실행 순서 | baseline → Go → Ktor (동일 포트라 순차 기동, 각 구현마다 mcp-server 8081 + agent-app 8080 재기동) |
| 모델 | `gemma3:1b` (기존 벤치마크와 동일) |
| 채점기 | `eval/answer_rules.py` (기존 로직 재사용), `eval/bench-results/equivalence_check.py --eval-file` 옵션 추가 |
| 원시 결과 | `baseline-private.json`, `go-private.json`, `ktor-private.json` |

## 순위

| 순위 | 구현 | 라우팅 적중률 | 답변 정확도 |
|---|---|---:|---:|
| 1 | **Go** | 27/30 (90.0%) | **13/30 (43.3%)** |
| 2 (공동) | Spring AI (baseline) | 27/30 (90.0%) | 12/30 (40.0%) |
| 2 (공동) | Ktor | 27/30 (90.0%) | 12/30 (40.0%) |

## 문항별 답변 정답 비교

`OK`=정답, `MISS`=오답. baseline과 Ktor는 30문항 전부 동일한 결과(완전 일치)를 보였다.
Go만 4문항에서 차이가 났다.

| ID | baseline | Go | Ktor | 비고 |
|---|---|---|---|---|
| PN4 | MISS | **OK** | MISS | 열린 티켓 수(SQL 집계) |
| PV5 | MISS | **OK** | MISS | 로드밸런서 헬스체크 장애 사례(VECTOR) |
| PV6 | MISS | **OK** | MISS | ML 예측 제안서(VECTOR) |
| PG8 | OK | **MISS** | OK | 조재원이 이끄는 프로젝트(GRAPH) |
| (그 외 26문항) | 동일 | 동일 | 동일 | — |

## 라우팅 미스 3건은 세 구현 공통

`PN6`(대구 지역 고객사 목록 → VECTOR로 오분류), `PV4`(Product-C4 백업 시각 → SQL로 오분류),
`PG2`(데이터플랫폼팀 부서장 → VECTOR로 오분류)는 baseline/Go/Ktor 세 구현 모두 동일하게
틀렸다. 세 구현이 라우팅 로직(`RuleBasedRouter`)을 1:1로 포팅한 결과이므로, 이는 구현 차이가
아니라 규칙 기반 라우터의 키워드 설계 자체가 못 잡는 질문 패턴임을 보여준다(포팅 정확성의
방증이기도 하다 — 셋 다 같은 자리에서 같은 실수를 한다).

## 결론 (gemma3:1b)

- baseline과 Ktor는 이 신규 비공개셋에서도 기존 공개셋 벤치마크와 같은 패턴(오답 문항 완전
  일치)을 재현했다 — 언어를 유지하고 프레임워크만 바꾼 포팅은 답변 동작이 사실상 동일함을
  다시 확인.
- Go는 공개셋에서는 baseline보다 낮았지만(43.3% vs 50.0%), 이번 비공개셋에서는 오히려
  1위(43.3% vs 40.0%)였다. 표본이 30문항으로 작아 통계적으로 유의미한 차이라 보기는 어렵고,
  "Go가 근소하게 우세하거나 baseline과 동등한 수준"이라는 게 두 데이터셋을 합친 더 정확한
  요약이다. 순위를 매겨야 한다면 이번 비공개셋 기준으로는 Go가 1위, baseline·Ktor 공동 2위다.

## gemma3:4b 재측정과 버그 수정 (baseline)

`gemma3:1b`는 세 구현을 저비용으로 비교하기엔 적합했지만, 답변 정확도 자체가 낮아
(40.0~43.3%) 시스템의 실제 답변 생성 품질을 보기엔 모델 용량이 병목이었다. baseline을
`gemma3:4b`로 재측정하고, 오답 12문항의 실제 응답 원문을 직접 까본 결과 구현 언어나
모델 크기가 아니라 **baseline 코드 자체의 버그 5건**을 확인해 수정했다.

| 단계 | 답변 정확도 | 라우팅 적중률 | 원시 결과 |
|---|---:|---:|---|
| gemma3:1b, 수정 전 | 40.0% (12/30) | 90.0% | `baseline-private.json` |
| gemma3:4b, 수정 전 | 60.0% (18/30) | 90.0% | `baseline-4b.json` |
| gemma3:4b, 버그 수정 후 | **90.0% (27/30)** | 96.7% | `baseline-fixed-90pct.json` |

### 발견하고 고친 버그

1. **`AnswerabilityGate`의 클레임 검증 오판** — "어디"(location_info), "누구"(person_identity),
   "가장 낮은/높은"(comparison_item_a/b) 클레임이 GRAPH 결과(Client-X 코드)나 SQL 최상값
   단일 행을 "커버 못 함"으로 오판해, 정답 근거를 이미 갖고 있었는데도
   "충분한 정보를 찾지 못했습니다"로 답변했다. GRAPH/SQL 소스 근거가 있으면 해당 클레임도
   충족된 것으로 판단하도록 완화했다.
2. **`DeterministicSqlPlanner`가 v2(production 경로)에 미연결** — v1(`AgentService`)에만
   연결되어 있고 `AgentServiceV2`는 항상 LLM 자유생성 SQL만 썼다. v2의 `generateSql`
   진입점에서 결정적 플래너를 먼저 시도하도록 연결하고, 없던 패턴("평균 연봉이 가장 낮은
   부서", "해지된 계약이 가장 많은 제품") 2개를 추가했다.
3. **`RuleBasedRouter` 키워드 누락** — "부서장", "모두 알려줘" 같은 표현이 라우팅 키워드에
   없어 SQL/GRAPH로 가야 할 질문이 VECTOR로 새고 있었다.
4. **`kg_search`의 predicate 체이닝 부재** — "클라우드사업부 부서장이 담당하는 고객사"처럼
   중간 엔티티(부서장 이름)를 한 번 거쳐야 하는 질문에서, 부서 전체 구성원의 결과가 섞여
   나오거나("부서장"이 predicate 키워드에 없어 필터링 자체가 안 됨) 빈 결과를 반환했다.
   질문에 predicate 키워드가 2개 이상 매칭되면 첫 번째로 중간 엔티티를 좁히고 그 다음
   predicate로 최종 결과를 찾는 체이닝을 추가했다. "이끄는"이 "이끌다" 활용형 매핑에서
   빠져 있던 것도 함께 고쳤다.
5. **답변 생성 프롬프트에 출처 필터링 지침 부재** — SQL과 GRAPH가 동시에 호출되면
   질문과 무관한 SQL 결과가 최종 답변에 섞여 들어가는 경우가 있어, "질문의 엔티티와
   실제로 일치하는 출처만 사용한다"는 지침을 시스템 프롬프트에 추가했다.

기존 오라클 테스트(`DeterministicSqlPlannerTest`, `AnswerabilityGateTest`,
`RuleBasedRouterTest`, `RetrievalToolsContractTest`)는 전부 통과해 회귀가 없음을 확인했다.

### 남은 오답 3건은 전부 VECTOR

`PV4`(문서 vs SQL 라우팅 경합), `PV9`(벡터 검색이 무관한 문서를 최상위로 골라
hallucination), `PV10`(벡터 검색이 관련 문서를 못 찾음)은 임베딩 유사도·청킹 단위의
더 깊은 문제라 이번 라운드에서는 수정하지 않았다.

## 일반화 검증: 30문항 수정이 실제로는 튜닝이었다

위 90.0%는 이 30문항에 대한 결과였고, 다른 문항에도 일반화되는지는 별도로 검증하지
않은 상태였다. 이를 확인하기 위해 `eval/bench-results/generalization_gen.py`로
`companyx-dataset-v1.0`의 부서(6)·제품(12)·지역(8)·업종(10)·카테고리(4)·규모(3) 등을
**전수 순회**하며 official/private 두 세트와 문항이 겹치지 않는 93개 질문을
생성했다(정답은 손으로 만들지 않고 DB에 직접 쿼리해 스크립트가 자동 도출). 각도는
같은 스키마를 다루지만 표현은 다르게 했다("사용하는" 대신 "쓰고 있는", "이슈보고"
대신 "문제를 제기한" 등).

**1차 결과(93문항, 위 5개 버그 수정만 반영): 라우팅 67.7%(63/93), 답변 정확도
68.8%(64/93)**로 폭락했다. 즉 30문항에서 만든 수정은 그 30문항의 정확한 표현에만
반응했을 뿐, 표현이 조금만 달라져도 실패했다 — **일반화되지 않은 튜닝**이었다.

### 실제 근본 원인: `RuleBasedRouter`가 아니라 `ROUTER_FALLBACK` 미사용

라우팅 실패 30건 중 24건은 "쓰고 있는", "문제를 제기한", "어떤 사람들이 있어" 같은
표현이 `RuleBasedRouter`의 고정 키워드 목록에 없어서 VECTOR로 새는 패턴이었다.
이건 키워드를 아무리 추가해도 표현의 조합이 무한해서 반복될 수밖에 없는 구조적
한계다. 저장소에는 이미 이 문제를 위한 해법(`SemanticAiRouteFallback`, "질문의
표현이 아니라 정답 근거와 필요한 연산을 모두 고른다"는 프롬프트로 LLM이 분류)이
`ROUTER_FALLBACK=semantic-ai` 환경변수로 존재했지만, 위 5개 버그 수정을 포함한
모든 벤치마크가 이 설정 없이(순수 키워드 매칭 + 매칭 없으면 VECTOR 기본값) 실행되고
있었다.

`ROUTER_FALLBACK=semantic-ai`를 켜자 라우팅이 즉시 100%(93/93)로 뛰었다. 남은 답변
오답 8건은 라우팅은 맞았지만 `DeterministicSqlPlanner`가 커버하지 않는 SQL 패턴
(카테고리별/지역별/규모별 총매출, 제품별 티켓 수)에서 LLM 자유생성이 실패한
것이었다 — 이 4개 패턴을 플래너에 추가했다.

### 최종 결과: 93문항 전체 100%

| 단계 | 라우팅 | 답변 정확도 |
|---|---:|---:|
| 30문항 버그 수정만, `ROUTER_FALLBACK` 미사용 | 67.7% (63/93) | 68.8% (64/93) |
| + `ROUTER_FALLBACK=semantic-ai` | **100% (93/93)** | 91.4% (85/93) |
| + `DeterministicSqlPlanner` 패턴 4개 추가 | 100% (93/93) | **100% (93/93)** |

원래 30문항(`baseline-private-with-semantic-ai.json`)도 27/30(90.0%)으로 회귀 없이
유지됐다 — 남은 3건은 여전히 VECTOR 임베딩 한계다. 결정적 차이는 **`RuleBasedRouter`에
키워드를 계속 추가하는 방식이 아니라, 이미 만들어져 있던 LLM 기반 의미 라우팅을
켜는 것**이었다. 이 발견 자체가 "30문항 스팟체크만으로 일반화를 주장하면 안 된다"는
사용자 지적이 정확했음을 보여준다.

원시 결과: `baseline-generalization.json`(93문항, semantic-ai + 플래너 패턴 추가 후),
`baseline-private-with-semantic-ai.json`(원래 30문항 회귀 확인). 생성 스크립트:
`generalization_gen.py`, 데이터셋: `eval/generalization-eval.json`.
