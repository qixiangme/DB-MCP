# Riwonace MCP 지능형 데이터 플랫폼

사내의 문서, 관계형 테이블, 지식 그래프를 한곳에서 조회하고 일상어 질문에 근거 있는 답을
제공하는 **온프레미스 AI 데이터 검색 플랫폼**입니다. 외부 AI API 대신 로컬 Ollama 모델을
사용하고, 데이터 접근은 MCP(Model Context Protocol) 도구로 표준화합니다.

이 프로젝트가 최적화하는 대상은 MCP 서버 프레임워크 하나가 아니라
**의도 라우팅 → 세 가지 MCP 실행 도구 → 선택적 컨텍스트 → 소형 LLM 답변**의 전체
파이프라인입니다. 지정과제와 참조 연구를 코드에 연결한 범위는
[지정과제 정합성 문서](./docs/CONTEST_ALIGNMENT.md)에 정리했습니다.

질문은 성격에 따라 다음 경로로 처리됩니다.

- 개념·정책·문서 질문 → pgvector 기반 `vector_search`
- 통계·집계·목록 질문 → 스키마 기반 NL2SQL → 읽기 전용 `run_sql`
- 사람·제품·프로젝트 사이의 관계 질문 → 지식 그래프 `kg_search`
- 복합 질문 → 필요한 도구를 병렬 호출한 뒤 근거를 선별하여 답변 생성

답변에는 선택한 라우트, 호출한 MCP 도구, 컨텍스트 출처, 지연 시간을 함께 제공하므로
어떤 데이터로 답했는지 확인할 수 있습니다.

## 전체 구조

```text
사용자 / React 웹 클라이언트
              │ HTTP :8080
              ▼
       agent-app (Spring AI)
       라우팅 · NL2SQL · 답변 생성
              │ MCP/SSE
       ┌──────┴────────────────────┐
       ▼                           ▼
mcp-server :8081             air-server :8082
기본 Spring AI 구현           선택형 AIR 구현
       └──────┬────────────────────┘
              ▼
 PostgreSQL 16 + pgvector ── Ollama
 관계형·벡터·그래프 저장       로컬 추론·임베딩
```

기본 실행 경로는 `agent-app` → `mcp-server`입니다. `air-server`는 기본 서버를 동시에
실행하기 위한 모듈이 아니라, 같은 MCP 도구 계약을 다른 프레임워크로 구현해 서버를
교체할 수 있음을 검증하기 위한 선택형 구현입니다.

## 기술 스택

| 영역 | 기술 | 사용 목적 |
|---|---|---|
| 언어·런타임 | Kotlin 2.1, Java 17+ | 에이전트와 기본 MCP 서버 |
| 애플리케이션 | Spring Boot 3.5, Spring AI 1.0 | Ollama, MCP 서버·클라이언트, pgvector 연동 |
| 표준 프로토콜 | MCP, SSE | 에이전트와 데이터 도구의 구현 분리 |
| 데이터베이스 | PostgreSQL 16, pgvector | 관계형 데이터, 문서 벡터, 지식 그래프 통합 저장 |
| 로컬 AI | Ollama, `gemma3:1b`, `nomic-embed-text` | 답변·NL2SQL 생성과 문서 임베딩 |
| 대체 MCP 구현 | Node.js, `@airmcp-dev/core`, `pg` | AIR 호환성 및 서버 교체 가능성 검증 |
| 웹 클라이언트 | React 19, TypeScript 5.7, Vite 6 | 선택형 대화 UI |
| 빌드·검증 | Gradle Kotlin DSL, npm, JUnit 5, Docker Compose | 빌드, 테스트, 로컬 인프라 실행 |

저사양 PC의 기본 모델 용량은 약 1.1GB입니다. 환경에 따라
`OLLAMA_MODEL=qwen2.5:3b`처럼 모델만 교체할 수 있습니다. 자세한 선택 기준은
[경량·안정성 원칙](./LIGHT-AND-STABLE.md)을 참고하세요.

## 모듈

| 모듈 | 포트 | 역할 |
|---|---:|---|
| `agent-app` | 8080 | 질문 라우팅, NL2SQL, 컨텍스트 큐레이션, 답변 생성, HTTP API |
| `mcp-server` | 8081 | 기본 MCP 서버. 실행 도구 3종, 스키마 Resource와 데이터 적재 제공 |
| `air-server` | 8082 | 동일한 도구 이름과 안전 정책을 제공하는 선택형 Node.js MCP 서버 |
| `client` | 5173 | 선택형 React 웹 클라이언트 |
| PostgreSQL + pgvector | 5433 | 문서 벡터, 관계형 데이터, 지식 그래프 저장 |
| Ollama | 11434 | 로컬 대화 모델과 임베딩 모델 실행 |

MCP 서버가 제공하는 실행 도구(Action)는 지정과제 설명과 같은 세 가지입니다.

| 도구 | 역할 |
|---|---|
| `vector_search` | 질문과 의미적으로 가까운 문서 검색 |
| `run_sql` | 검증을 통과한 읽기 전용 SELECT/WITH 실행 |
| `kg_search` | 주어–관계–목적어 형태의 지식 그래프 탐색 |

NL2SQL에 필요한 테이블·열·외래키·값 힌트는 실행 도구가 아니라
`db://schema` MCP Resource(Knowledge)로 제공합니다. SQL 경로는 이 Resource로 SELECT를
생성한 뒤 `run_sql`을 호출합니다.

## MCP 아키텍처

이 프로젝트는 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)을 사용하여
에이전트와 데이터 도구 사이의 통신을 표준화합니다.

### MCP 통신 흐름

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         agent-app (:8080)                           │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │ ChatController│───▶│ AgentService │───▶│ McpGateway            │  │
│  │ POST /api/chat│    │ 라우팅/NL2SQL │    │ MCP 클라이언트 래퍼   │  │
│  └──────────────┘    └──────────────┘    └───────────┬───────────┘  │
└──────────────────────────────────────────────────────┼──────────────┘
                                                       │ MCP/SSE
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        mcp-server (:8081)                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      RetrievalTools                          │   │
│  │  ┌─────────────┐ ┌───────────┐ ┌─────────┐ ┌───────────────┐ │   │
│  │  │vector_search│ │ run_sql  │ │   kg_search   │  db://schema │ │   │
│  │  │ 문서 검색   │ │ SQL실행  │ │ 그래프 탐색   │  Resource(K) │ │   │
│  │  └──────┬──────┘ └────┬────┘ └───────┬───────┘ └─────┬──────┘ │   │
│  └─────────┼──────────────┼────────────┼──────────────┼─────────┘   │
│            │              │            │              │             │
│            ▼              ▼            ▼              ▼             │
│  ┌──────────────┐  ┌────────────┐  ┌─────────┐  ┌────────────┐      │
│  │  VectorStore │  │JdbcTemplate│  │SqlGuard │  │JdbcTemplate│      │
│  │  (pgvector)  │  │  (schema)  │  │(보안검증)│  │ (kg_triples)│     │
│  └──────┬───────┘  └─────┬──────┘  └────┬────┘  └─────┬──────┘      │
└─────────┼────────────────┼──────────────┼─────────────┼─────────────┘
          │                │              │             │
          ▼                ▼              ▼             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL 16 + pgvector                         │
│  ┌────────────────┐  ┌─────────────┐  ┌────────────────────────┐    │
│  │  vector_store  │  │ employees   │  │      kg_triples        │    │
│  │  (문서 임베딩) │  │ departments │  │  (subject, predicate,  │    │
│  │                │  │ projects    │  │   object)              │    │
│  └────────────────┘  └─────────────┘  └────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### MCP 서버 설정

`mcp-server`는 Spring AI MCP Server로 구현되어 있으며, 다음과 같이 설정됩니다:

```yaml
# mcp-server/src/main/resources/application.yml
spring:
  ai:
    mcp:
      server:
        name: riwonace-data-platform
        version: 1.0.0
        type: SYNC    # 동기 MCP 서버
```

### MCP 도구 상세

| 도구 | 입력 | 출력 | 보안 |
|---|---|---|---|
| `vector_search` | `query: String`, `topK?: Int` | 유사 문서 목록 (source, score, text) | 출력 크기 제한 (4KB) |
| `run_sql` | `sql: String` | 실행 결과 JSON (rows) | SqlGuard 검증, SELECT만 허용 |
| `kg_search` | `query: String` | 관계 트리플 목록 | 2홉 확장, 40개 제한 |

| Resource | 내용 | 사용 범위 | 보호 |
|---|---|---|---|
| `db://schema` | 테이블/컬럼 + 외래키 + 값 힌트 | NL2SQL 생성 전용 | 비대상 테이블 제외, 8KB 제한 |

### MCP 클라이언트 (McpGateway)

`agent-app`에서 MCP 서버를 호출하는 게이트웨이:

```kotlin
// agent-app/src/main/kotlin/com/riwonace/agent/mcp/McpGateway.kt
@Component
class McpGateway(private val clients: List<McpSyncClient>) {

    fun vectorSearch(query: String, topK: Int = 4): String =
        callTool("vector_search", mapOf("query" to query, "topK" to topK))

    fun runSql(sql: String): String =
        callTool("run_sql", mapOf("sql" to sql))

    fun kgSearch(query: String): String =
        callTool("kg_search", mapOf("query" to query))

    fun schema(): String =  // 프로세스 내 캐시
        client.readResource(McpSchema.ReadResourceRequest("db://schema"))
}
```

MCP가 청킹·임베딩·검색 단계를 없애는 것은 아닙니다. 이 단계와 접속 정보를 MCP 서버 뒤에
캡슐화하여 에이전트가 `McpGateway` 한 곳만 관리하도록 만들고, 벡터·정형·그래프 저장소를
PostgreSQL 하나로 통합한 것이 이 프로젝트의 복잡도 절감 범위입니다.

### 보안 계층

MCP 도구는 다음 보안 계층을 거칩니다:

1. **SqlGuard**: 토큰화 기반 SQL 검증
   - SELECT/WITH만 허용, DML/DDL 차단
   - 위험 함수 차단 (pg_sleep, pg_read_file 등)
   - LIMIT 자동 추가 (기본 50)

2. **ToolResponseEncoder**: 출력 보호
   - 최대 출력 크기 제한
   - 에러 메시지 일반화 (내부 정보 노출 방지)

3. **경로 검증** (IngestController)
   - 상위 디렉토리 탈출 방지
   - 심볼릭 링크 검사

## AIR와 Spring AI 구현이 모두 있는 이유

이 프로젝트의 핵심 경계는 특정 프레임워크가 아니라 MCP 도구 계약입니다.

- **Spring AI `mcp-server`가 기본 구현**입니다. Gradle 멀티모듈 빌드, Spring AI MCP,
  Ollama, pgvector가 통합되어 있고 데이터 적재와 자동화 테스트를 담당합니다.
- **AIR `air-server`는 선택형 비교 구현**입니다. Node.js의 AIR MCP 프레임워크로 같은
  도구 이름을 노출해, `agent-app` 코드를 바꾸지 않고 서버 URL만 교체할 수 있음을 검증합니다.
- 두 구현 모두 실행 도구 3종과 `db://schema` Resource 계약을 제공하며, 이를 통해
  프로토콜 호환성, 프레임워크 종속성, 성능과 동작 차이를 같은
  클라이언트에서 비교할 수 있습니다.
- AIR는 현재 Gradle 기본 빌드와 기본 실행 경로에 포함되지 않으며, 벡터 데이터 적재는
  Spring AI 서버에서 먼저 수행해야 합니다.

AIR 구현으로 전환할 때는 Spring AI 서버로 데이터를 한 번 적재한 뒤 다음과 같이 실행합니다.

```bash
npm ci --prefix air-server
npm --prefix air-server start

# 별도 터미널
MCP_SERVER_URL=http://localhost:8082 ./gradlew :agent-app:bootRun
```

기본 Spring AI 구현으로 돌아가려면 `MCP_SERVER_URL`을 생략하거나
`http://localhost:8081`로 설정합니다.

키워드가 전혀 걸리지 않는 질문에서 90%대 라우팅을 재현한 설정은 다음과 같습니다.

```bash
OLLAMA_MODEL=gemma3:4b ROUTER_FALLBACK=semantic-ai ./gradlew :agent-app:bootRun
```

공개셋 93.3%, 키워드 무교집합 보류셋 96.7%이며 100%는 아닙니다. 평가 범위와 원시 결과는
[키워드 없는 라우팅 실험 결과](./docs/research/KEYWORDLESS_ROUTING_RESULTS.md)를 참고하세요.
Company-X 전체 스택에서는 공식 원문 답변 66.7%, 키워드 제거 답변 50.0%를 측정했습니다.

## 빠른 시작

필수 조건은 Docker 엔진과 Java 17+입니다.

```bash
# 1. PostgreSQL과 Ollama 실행
docker compose up -d

# 2. 모델 다운로드(최초 1회)
docker exec riwonace-ollama ollama pull gemma3:1b
docker exec riwonace-ollama ollama pull nomic-embed-text

# 3. 기본 Spring AI MCP 서버 실행
./gradlew :mcp-server:bootRun

# 4. 공식 Company-X 문서 40건을 서버 적재 API로 교체 적재
python3 eval/ingest-company-docs.py

# 5. 별도 터미널에서 에이전트 실행
./gradlew :agent-app:bootRun
```

문서 적재 명령은 Ollama나 PostgreSQL에 직접 접속하지 않고 `mcp-server`의 운영 API를
호출합니다. 같은 데이터셋을 다시 실행하면 기존 40건을 트랜잭션 안에서 교체하므로 중복되지
않습니다. 성공 응답의 `ingested`와 `replaced`가 각각 `40`인지 확인하세요.

웹 UI를 사용하려면 별도 터미널에서 다음 명령을 실행합니다.

```bash
cd client
npm ci
npm run dev
```

### 사용 예시

```bash
# 개념 질문 → vector_search
curl -s -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" \
  -d '{"question": "MCP가 기존 RAG보다 뭐가 좋아?"}'

# 집계 질문 → NL2SQL + run_sql
curl -s -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" \
  -d '{"question": "플랫폼팀 직원의 평균 급여는 얼마야?"}'

# 관계 질문 → kg_search
curl -s -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" \
  -d '{"question": "AIR는 누가 개발했어?"}'

# MCP 연결 상태와 노출 도구 확인
curl -s http://localhost:8080/api/tools

# Ollama를 나중에 실행한 경우 시드 문서 재적재
curl -s -X POST http://localhost:8081/admin/ingest
```

응답에는 답변과 함께 라우팅 결과(`routes`), 호출된 MCP 도구(`toolCalls`),
사용한 컨텍스트 출처(`contextSources`), 지연 시간(`latencyMs`)이 포함되어
시스템의 판단 과정을 투명하게 확인할 수 있습니다.

구형 벤치마크 결과가 평면 배열 포맷이면 `python3 eval/normalize_legacy_results.py` 또는
`powershell -File eval\rescore.ps1`로 `metadata`/`summary`/`rows` 구조의 결과 파일로
정규화한 뒤 비교합니다.

## 테스트

```bash
# Kotlin 전체 테스트
./gradlew test

# 웹 클라이언트 빌드
cd client
npm ci
npm run build
```

벤치마크를 변경했다면 같은 데이터셋·모델·설정·반복 횟수로 기준선과 후보를 모두 측정하고,
문항별 원시 JSON 결과를 보존해야 합니다.

## 문서 안내

| 문서 | 내용 |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 전체 구조, 요청 처리 흐름, 주요 설계 결정 |
| [지정과제 정합성](./docs/CONTEST_ALIGNMENT.md) | 도구 3종, K/A 분리, MCP 복잡도 절감 범위, TACC 적용 근거 |
| [제출 후보 벤치마크](./docs/research/CONTEST_FINAL_BENCHMARK.md) | 복합 질문·TACC·AIR/Spring·장애 주입 3회 결과와 채택 판정 |
| [AIR 적용 리뷰](./docs/research/AIR_FRAMEWORK_FEEDBACK.md) | AIR의 장점, 운영 보강점과 Spring AI 유지 근거 |
| [레드팀 보안 검토](./docs/security/RED_TEAM_REVIEW_2026-08-13.md) | 런타임 공격면과 Spring AI/AIR 통합 보안 판정 |
| [LIGHT-AND-STABLE.md](./LIGHT-AND-STABLE.md) | 소형 모델 선택과 경량·안정성 원칙 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 기여자가 먼저 확인할 핵심 규칙 |
| [이슈와 PR 운영 절차](./docs/contributing/WORKFLOW.md) | 작업 유형, 브랜치, 리뷰 게이트, PR 절차 |
| [벤치마크 무결성 정책](./docs/contributing/BENCHMARK_POLICY.md) | 데이터 누수 방지, 재현 조건, 최소 통과 기준 |

## 기여하기

기여를 시작하기 전에 [CONTRIBUTING.md](./CONTRIBUTING.md)를 읽어 주세요. 이슈 등록,
브랜치 작성, 테스트와 벤치마크, PR 템플릿, Draft·Ready·Close 판정 기준을 한곳에
정리했습니다. 보안 취약점은 공개 이슈 대신
[비공개 보안 제보](https://github.com/qixiangme/DB-MCP/security/advisories/new)를 이용해 주세요.
