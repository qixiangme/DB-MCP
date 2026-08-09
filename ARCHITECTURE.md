# 아키텍처 설계서

> 과제: MCP 기반 지능형 데이터 플랫폼 클러스터 (리원에이스 지정과제)
> 목표: **복잡하고 비싼 세팅 없이, 표준 규격(MCP)만으로, 가벼운 로컬 모델로도 안정적으로 정답을 찾아내는 시스템**

## 1. 전체 구조

```
사용자 질문 (일상어)
   │  POST /api/chat
┌──▼──────────────────────────────────┐          ┌──────────────────────────────────────┐
│  agent-app  (Spring Boot :8080)     │          │  mcp-server  (Spring Boot :8081)     │
│                                     │   MCP    │                                      │
│  ① RuleBasedRouter  (L4 라우팅)     │  (SSE)   │  MCP Tools — 표준 규격 단일 접점      │
│     키워드 규칙 + 선택형 fallback,   │◀────────▶│   ├ vector_search → pgvector 유사도  │
│     복합 질문은 병렬 호출           │  장애    │   ├ run_sql       → SqlGuard 검증    │
│  ② NL2SQL           (L6 추론)      │  지점    │   ├ kg_search     → 온톨로지 triple  │
│  ③ ContextCurator   (L5 구성)      │  1개     │   └ get_schema    → 스키마 조회      │
│     TACC: 예산·선별·전략적 배치     │          │                                      │
│  ④ 답변 생성        (L7 응답)      │          └──────────────┬───────────────────────┘
└──────────┬──────────────────────────┘                        │ JDBC
           │ HTTP                                 ┌────────────▼───────────────────────┐
┌──────────▼──────────────┐                       │  PostgreSQL 16 + pgvector (:5433)  │
│  Ollama (:11434)        │                       │   ├ vector_store  (문서 임베딩)     │
│   ├ gemma3:1b (추론)    │                       │   ├ employees/products/orders      │
│   └ nomic-embed-text    │                       │   └ kg_triples   (지식 그래프)      │
└─────────────────────────┘                       └────────────────────────────────────┘
```

## 2. 과제 요구사항 매핑

| 요구사항 | 구현 |
|---|---|
| PostgreSQL + pgvector 벡터 DB | `pgvector/pgvector:pg16` 컨테이너, Spring AI `PgVectorStore` (HNSW, cosine) |
| MCP 프로토콜 기반 도구 설계 | Spring AI MCP Server(WebMVC/SSE)로 도구 4종 노출 — 클라이언트는 표준 MCP로만 접근 |
| 규칙 기반 라우터 (MCP Parallel) | `RuleBasedRouter`: 키워드 규칙으로 SQL/VECTOR/GRAPH 분류, 복수 매칭 시 병렬 호출. 미일치 질문은 주입된 `RouteFallback`으로 분류하고 없으면 VECTOR 사용 |
| NL2SQL | `get_schema`의 테이블·외래키·값 힌트 → 질문별 few-shot·schema linking → SELECT 생성 → `SqlGuard` 검증 → 오류·빈 결과 시 최대 2회 자가수정 |
| 온톨로지 기반 지식 그래프 | `kg_triples` (subject–predicate–object), `kg_search` 도구로 조회 |
| 온프레미스 소형 LLM 연동 | Ollama `gemma3:1b` 기본 (~815MB, CPU만으로 구동), `OLLAMA_MODEL` 환경변수 하나로 1B~7B 교체 |
| 선택적 컨텍스트 큐레이션 (TACC) | `ContextCurator`: 과업 유형별 가중치 → 문자 예산 내 선별 → Lost-in-the-Middle 완화 배치 |

## 3. 핵심 설계 결정

### 3.1 결정적 규칙을 우선하고 미일치 질문만 fallback한다
1B~7B급 소형 모델의 function-calling은 불안정하다. `RuleBasedRouter`는 키워드가 일치하면
**결정적 규칙으로 도구를 선택**한다. 어떤 규칙에도 일치하지 않을 때만 주입된
`RouteFallback`에 위임하고, fallback이 없으면 VECTOR를 사용한다. 따라서 키워드 경로의
재현성을 유지하면서 비중첩 질문만 별도 전략으로 보완할 수 있다.

### 3.2 장애 지점 1개 (기존 RAG 3개 대비)
기존 RAG는 임베딩 서비스·검색 인덱스·리랭커 3개의 장애 지점을 가진다.
본 시스템에서 에이전트가 아는 외부 연결은 **MCP 연결 하나**(`McpGateway`)뿐이다.
벡터 검색, SQL, 지식 그래프의 내부 구현·접속 정보는 모두 MCP 서버 뒤에 숨는다.
저장소도 PostgreSQL 하나로 통합해(벡터+관계형+그래프) 운영 대상 자체를 줄였다.

### 3.3 튜닝 파라미터 2개
과제 참조 연구와 동일하게, 운영자가 조정하는 파라미터는
**① 검색 top-k**(기본 4), **② 컨텍스트 예산**(`agent.context.budget-chars`, 기본 2,400자) 뿐이다.
청킹·오버랩·리랭커 임계값 등은 존재하지 않는다.

### 3.4 TACC — 컨텍스트는 많을수록 좋은 게 아니다
전현우 외(2026)의 실증대로 소형 모델에는 선별된 컨텍스트가 유리하다. `ContextCurator`는:
1. 라우트별 가중치 (SQL 결과는 집계 질문에서 1.5배 등)
2. 중복 제거 + 관련도 순 예산 내 선별
3. Liu et al.(2024) 'Lost in the Middle' 완화 — 최상위 항목을 맨 앞, 차상위를 맨 뒤에 배치

### 3.5 제로 트러스트 SQL (SqlGuard)
LLM이 생성한 SQL은 신뢰하지 않는다. SELECT/WITH 단일 문장만 허용,
DML·DDL·주석·다중 문장·`pg_sleep` 차단, LIMIT 자동 보강. 단위 테스트로 검증.

### 3.6 Pylon-7 계층 대응
| Pylon-7 계층 | 구현 위치 |
|---|---|
| L1 데이터 저장 | PostgreSQL (vector_store, 관계형, kg_triples) |
| L2 검색·인덱싱 | pgvector HNSW, SQL, triple 조회 |
| L3 프로토콜 | MCP (Spring AI MCP Server/Client, SSE) |
| L4 라우팅 | RuleBasedRouter (MCP Parallel) + 선택형 RouteFallback |
| L5 컨텍스트 구성 | ContextCurator (TACC) |
| L6 추론 | Ollama gemma3:1b (NL2SQL, 답변 생성) — `OLLAMA_MODEL`로 교체 가능 |
| L7 응답 생성 | AgentAnswer (답변 + 라우팅/도구/출처/지연시간 투명 공개) |

## 4. 요청 처리 흐름 (예: "플랫폼팀 평균 급여는?")

1. `RuleBasedRouter`가 "평균", "급여" 키워드로 **SQL 라우트** 선택. 키워드가 없을 때만 설정된 fallback 사용
2. `McpGateway.schema()` — MCP `get_schema` 호출 (캐시됨)
3. `SchemaPromptFormatter`가 테이블·외래키·값 힌트를 구조화하고, `SchemaLinker`와
   `FewShotSelector`가 질문에 맞는 힌트와 예시 하나를 선택
4. 소형 모델이 허용된 스키마와 외래키만 사용해 SELECT 생성
5. MCP `run_sql` 호출 → `SqlGuard` 검증 후 실행. 오류·비정상 빈 결과는 피드백과 함께 최대 2회 재생성

일반 MCP 도구 응답은 4,000자, `get_schema`는 8,000자 예산 안에서 유효한 JSON을 유지합니다.
직렬화 결과가 예산을 넘으면 일부 JSON 문자열을 그대로 자르지 않고 `tool_output_too_large`, `truncated`,
`originalChars`, `maxOutputChars`를 포함한 구조화된 오류 객체를 반환합니다. 호출자는 이 경우
부분 데이터를 정상 결과로 해석하지 말고 질의를 좁히거나 더 작은 `topK`로 다시 요청해야 합니다.
6. `ContextCurator`가 예산 내 컨텍스트 구성
7. 소형 모델이 컨텍스트 근거로 한국어 답변 생성 (+출처 표기)

## 5. 스택 선택 근거

- **Spring AI (vs Koog)**: MCP Server/Client, Ollama, pgvector가 모두 공식 스타터로 제공되어
  글루 코드가 최소화된다. Koog는 에이전트 DSL은 우수하나 MCP 서버 구현·pgvector 통합을
  직접 작성해야 해 과제의 "장애 지점 축소" 취지와 어긋난다.
- **멀티모듈 분리**: MCP 서버와 에이전트를 물리적으로 분리해 "표준 규격만으로 연결"됨을
  증명한다. 에이전트는 Claude Desktop 등 다른 MCP 클라이언트로 교체 가능하고,
  서버도 air 프레임워크 구현체로 교체 가능하다 (L3 계층 교체 가능성).
