# Protocol-Compiled AI 설계안

## 한 문장

**검색 파이프라인을 사람이 짜지 않고, MCP 도구들이 공개한 계약서를 읽어서 질문마다 필요한 실행 흐름을 자동 조립하는 시스템.**

더 쉽게 말하면 이렇다.

> 기존 시스템은 "질문이 오면 SQL, 벡터, 그래프 중 어디로 보낼지"를 앱 코드가 직접 판단한다.  
> 이 설계는 각 MCP 도구가 "나는 어떤 질문을 잘 풀고, 비용은 얼마고, 지금 살아 있는지"를 스스로 설명하게 만들고, 에이전트는 그 설명서를 보고 그때그때 최소 실행 계획을 만든다.

## 왜 이게 과제 핵심에 맞나

리원에이스 과제의 핵심 문장은 이것이다.

> 복잡한 파이프라인 대신 표준화된 프로토콜 하나로 AI가 데이터에 접근하는 구조를 설계하는 것.

그래서 좋은 아이디어는 "RAG를 더 잘한다", "라우터를 더 잘 만든다", "정확도를 더 올린다"에서 끝나면 약하다.

진짜로 찔러야 하는 지점은 이것이다.

> **MCP를 붙인 파이프라인이 아니라, MCP 때문에 파이프라인 코드가 줄어드는 시스템인가?**

Protocol-Compiled AI는 여기에 답한다.  
MCP를 단순 호출 규격으로 쓰는 게 아니라, 실행 계획을 만드는 재료로 쓴다.

## 현재 시스템과의 차이

현재 구조는 대략 이렇다.

```text
질문
 -> RuleBasedRouter가 SQL/VECTOR/GRAPH 선택
 -> 선택된 MCP 도구 호출
 -> ContextCurator가 결과를 잘라 붙임
 -> LLM이 답변 생성
```

이건 잘 만든 구조지만, 심사위원이 보면 이렇게 물을 수 있다.

> "그럼 MCP는 그냥 도구 호출 인터페이스 아닌가요? 기존 RAG 파이프라인을 MCP로 감싼 것 아닌가요?"

새 설계는 이렇게 바꾼다.

```text
질문
 -> MCP 도구 계약 수집
 -> 질문에 필요한 증거 타입 판정
 -> 살아 있는 도구 중 최소 비용 조합 선택
 -> 병렬/순차 실행 계획 생성
 -> 결과를 증거 단위로 합성
 -> 답변 생성
```

핵심 차이는 라우팅 규칙이 앱 코드에 고정되어 있지 않다는 점이다.

## 도구 계약 예시

각 MCP 도구는 단순히 이름과 입력값만 공개하지 않는다. 설명 안에 운영 메타데이터를 같이 공개한다.

```json
{
  "name": "run_sql",
  "capability": ["aggregate", "filter", "join", "count", "numeric_fact"],
  "evidenceType": "structured_table",
  "cost": 1,
  "latencyMs": 300,
  "deterministic": true,
  "fallback": null,
  "healthy": true
}
```

```json
{
  "name": "vector_search",
  "capability": ["policy", "manual", "incident_report", "semantic_retrieval"],
  "evidenceType": "document",
  "cost": 2,
  "latencyMs": 900,
  "deterministic": false,
  "fallback": "keyword_search",
  "healthy": true
}
```

```json
{
  "name": "kg_search",
  "capability": ["relationship", "dependency", "owner", "causal_path"],
  "evidenceType": "graph_relation",
  "cost": 1,
  "latencyMs": 400,
  "deterministic": true,
  "fallback": "run_sql",
  "healthy": true
}
```

이 메타데이터는 MCP 표준의 도구 이름, 설명, 입력 스키마 위에 얹는 얇은 계약이다.  
즉, 새 프레임워크를 만드는 게 아니라 MCP 도구 설명을 실행 계획의 재료로 확장한다.

## 실제 가치

### 1. 새 도구를 추가해도 앱 라우터를 고치지 않는다

현재 방식에서 `keyword_search`나 `ticket_search` 같은 네 번째 도구를 추가하면 라우터, 컨텍스트 가중치, 실패 처리, 테스트를 같이 건드려야 한다.

Protocol-Compiled AI에서는 도구가 자기 계약만 등록하면 된다.

```text
새 도구 추가 전: SQL / VECTOR / GRAPH
새 도구 추가 후: SQL / VECTOR / GRAPH / KEYWORD

앱 코드 변경: 최소화
도구 계약 추가: 필요
```

심사위원에게 보여줄 데모는 명확하다.

> "도구 하나를 새로 추가했는데, 에이전트 라우터 코드는 안 고쳤습니다. MCP 계약만 보고 새 도구를 실행 계획에 포함했습니다."

### 2. 장애가 나도 전체 파이프라인이 죽지 않는다

기존 파이프라인은 벡터 검색이 죽으면 RAG가 죽는다.  
이 설계에서는 도구 계약의 `healthy=false` 또는 호출 실패를 보고 다른 도구로 축소 운행한다.

예시:

```text
vector_search 장애
 -> vector_search 제외
 -> keyword_search 또는 kg_search + run_sql 조합으로 계획 재작성
 -> 답변에는 "문서 의미 검색은 제외하고 구조화 데이터 기준으로 답변"이라고 표시
```

이건 단순 예외처리가 아니다.  
장애 대응 방식 자체가 MCP 도구 계약 안으로 들어간다.

### 3. 튜닝 파라미터가 줄어든다

기존 RAG는 보통 이런 값들이 흩어진다.

```text
topK
chunkSize
overlap
similarityThreshold
rerankK
hybridWeight
contextWindow
routeThreshold
retryCount
```

Protocol-Compiled AI는 운영자가 만지는 값을 두 개로 압축한다.

```text
evidenceBudget: 답변 하나에 쓸 증거 비용
latencyBudgetMs: 답변 하나에 허용할 지연 시간
```

나머지는 도구 계약의 비용, 지연 시간, 증거 타입으로 자동 결정한다.

### 4. "컨텍스트를 많이 넣는 것"이 아니라 "필요한 증거만 산다"

참조 논문에서 말한 핵심이 "컨텍스트는 무조건 많을수록 좋은 게 아니다"라면, 구현도 그걸 보여줘야 한다.

이 설계에서는 질문을 먼저 증거 타입으로 바꾼다.

| 질문 유형 | 필요한 증거 | 호출 계획 |
|---|---|---|
| "평균 급여는?" | 숫자/집계 | get_schema -> run_sql |
| "장애 원인은?" | 문서 근거 | vector_search |
| "A와 B 관계는?" | 관계 | kg_search |
| "장애를 가장 많이 낸 고객의 계약 상태는?" | 집계 + 관계 + 문서 | run_sql + kg_search + vector_search |

컨텍스트는 문서 조각이 아니라 "증거 구매 목록"이 된다.

## 왜 참신한가

대부분 팀은 이렇게 할 가능성이 높다.

```text
MCP 서버 만들기
 -> vector_search / run_sql / kg_search 도구 등록
 -> 앱에서 라우팅
 -> 결과 합치기
```

이건 MCP를 잘 쓴 것이긴 하지만, 구조적으로는 기존 RAG와 비슷하다.

Protocol-Compiled AI는 질문이 다르다.

> "도구가 MCP로 표준화되었으면, 왜 라우터와 파이프라인은 아직 앱 코드에 박혀 있어야 하지?"

그래서 이 설계의 참신함은 "새 알고리즘"이 아니라 "소유권 이동"이다.

```text
기존: 앱 코드가 파이프라인을 소유
제안: MCP 도구 계약이 파이프라인을 소유
```

이게 리원에이스가 좋아할 포인트다.  
리원에이스는 MCP, 오픈소스 컨설팅, VectorDB 튜닝, DB 튜닝, AI Maker를 하는 회사다. 즉, 고객사마다 데이터 도구가 계속 달라지는 상황을 자주 본다.

그 회사 입장에서는 "정확도 3% 올렸습니다"보다 이 말이 더 사업적으로 꽂힌다.

> 고객사마다 다른 검색 파이프라인을 새로 짜는 대신, MCP 도구 계약만 등록하면 실행 계획이 자동으로 생깁니다.

## 냉정한 반대 의견

### 반대 1. "MCP 표준에 그런 capability 필드가 원래 있나요?"

완전히 표준 필드는 아니다. 그래서 과장하면 안 된다.

정확한 표현은 이렇다.

> MCP의 도구 이름, 설명, 입력 스키마를 기반으로 하고, 그 위에 실행 계획용 메타데이터를 얇게 추가한 설계다.

즉, MCP 바깥의 거대한 새 프레임워크가 아니라 MCP 도구 계약을 더 엄격하게 쓰는 방식이다.

### 반대 2. "자동 계획이 오히려 복잡한 거 아닌가요?"

맞다. LLM에게 자유롭게 계획을 맡기면 복잡해진다.

그래서 여기서 말하는 컴파일러는 거창한 AI 플래너가 아니다.  
규칙 기반 점수표다.

```text
질문에서 필요한 증거 타입 추출
 -> 해당 증거 타입을 제공하는 healthy 도구 필터링
 -> evidenceBudget / latencyBudget 안에서 가장 싼 조합 선택
 -> 결정적 도구는 먼저 실행
 -> 부족하면 비결정적 도구 보강
```

작고 예측 가능해야 한다. 그래야 "가볍고 단단한 시스템"이라는 과제 문구와 맞는다.

### 반대 3. "정확도 향상과 직접 연결되나요?"

직접적인 정확도 향상만 주장하면 약하다.  
이 설계의 1차 가치는 운영 복잡도 감소다.

다만 정확도에도 간접 효과가 있다.

```text
불필요한 컨텍스트 감소
도구 장애 시 대체 경로 사용
집계 질문은 결정적 SQL 우선
LLM이 읽기 힘든 JSON 결과는 템플릿 답변으로 처리 가능
```

정확도는 "부수 효과", 핵심 가치는 "변경 비용과 장애 비용 감소"로 잡아야 한다.

## 심사위원 앞에서 보여줄 데모

### 데모 1. 도구 추가 실험

1. 기존 도구: `run_sql`, `vector_search`, `kg_search`
2. 새 도구: `keyword_search`
3. 앱 라우터 코드는 수정하지 않음
4. `keyword_search` 계약만 추가
5. 특정 질문에서 실행 계획에 자동 포함되는지 보여줌

성공 문구:

> 새 검색 도구를 추가했지만 파이프라인 코드는 바꾸지 않았습니다. MCP 계약이 바뀌자 실행 계획이 바뀌었습니다.

### 데모 2. 장애 축소 운행 실험

1. `vector_search`를 강제로 실패시킴
2. 시스템이 해당 도구를 제외하고 계획 재작성
3. SQL/그래프/키워드만으로 가능한 범위의 답변 생성
4. 답변에 사용 가능한 증거와 제외된 증거를 표시

성공 문구:

> 장애를 try-catch로 숨긴 게 아니라, MCP 도구 상태가 실행 계획에서 빠졌습니다.

### 데모 3. 복잡도 삭제 실험

기존 설정:

```text
topK
similarityThreshold
rerankK
hybridWeight
contextBudget
routeRules
retryRules
fallbackRules
toolTimeouts
```

새 설정:

```text
evidenceBudget
latencyBudgetMs
```

성공 문구:

> 튜닝 값을 잘 맞춘 것이 아니라, 운영자가 만져야 할 튜닝 값을 없앴습니다.

## 최종 이름 후보

1. **Protocol-Compiled AI**
2. **MCP Contract Planner**
3. **MCP 실행계획 컴파일러**
4. **Pipeline-less RAG**
5. **계약 기반 검색 시스템**

발표용으로는 이 조합이 가장 좋다.

> **Protocol-Compiled AI: MCP 계약으로 검색 파이프라인을 컴파일하는 시스템**

## 최종 피치

> 기존 RAG는 질문이 들어오면 미리 짜둔 파이프라인을 통과시킨다.  
> 우리는 반대로, MCP 도구들이 공개한 계약을 읽고 질문마다 가장 작은 실행 계획을 만든다.  
> 그래서 새 도구를 붙여도 앱 라우터를 고치지 않고, 도구가 죽어도 계획에서 빠지며, 운영자가 만질 파라미터는 evidenceBudget과 latencyBudget 두 개로 줄어든다.  
> MCP를 단순 연결 규격으로 쓴 것이 아니라, 파이프라인을 줄이는 설계 단위로 사용했다.

## 구현 우선순위

1. MCP 도구별 계약 메타데이터 정의
2. 현재 `RuleBasedRouter` 옆에 `ContractPlanner` 추가
3. 질문을 `aggregate`, `document`, `relationship`, `mixed` 같은 증거 타입으로 분류
4. 계약 기반으로 도구 실행 계획 생성
5. 기존 `AgentService`의 route 기반 실행을 plan 기반 실행으로 교체
6. 응답에 `plan`, `evidenceBudgetUsed`, `degradedTools` 표시
7. 도구 추가/장애/설정 축소 데모 작성

## 이 아이디어가 약해지는 표현

아래 표현은 피해야 한다.

```text
MCP로 SQL, 벡터, 그래프를 연결했습니다.
RAG 정확도를 높였습니다.
라우터를 개선했습니다.
도구 호출을 표준화했습니다.
```

이렇게 말하면 평범하다.

대신 이렇게 말해야 한다.

```text
MCP를 붙인 것이 아니라, MCP 계약을 기준으로 검색 파이프라인 코드를 제거했습니다.
```

