# mcp-server-ktor

`mcp-server`(Kotlin/Spring AI)의 1:1 Ktor 포팅. 아키텍처·라우팅·SQL 처리·caching
정책을 임의로 개선하지 않고 동일한 MCP tool contract를 재현한다. 상세 배경은
저장소 루트 이슈 [#100](https://github.com/qixiangme/DB-MCP/issues/100),
[#102](https://github.com/qixiangme/DB-MCP/issues/102)을 참고.

## 제공 계약

- MCP Tool 3종: `vector_search`, `run_sql`, `kg_search` (baseline과 이름/파라미터/출력 shape 동일)
- MCP Resource 1종: `db://schema` (tool이 아님)

## 포팅하며 확인한 사실: Kotlin MCP SDK에는 Ktor transport가 없다

`io.modelcontextprotocol.sdk:mcp`(코어, transport-agnostic)는 baseline이 쓰는
`spring-ai-starter-mcp-server-webmvc`가 내부적으로 의존하는 것과 같은 버전
계열이지만, SSE 서버 transport는 `HttpServletSseServerTransportProvider`
(Servlet 전용) 하나만 제공한다. Ktor용 어댑터는 SDK에도, Ktor 생태계에도 없다.

그래서 `internal/transport/KtorSseServerTransportProvider.kt`가 SDK의
`McpServerTransportProvider` 인터페이스를 Ktor 위에 직접 구현한다: SSE GET
스트림에서 `endpoint` 이벤트로 세션별 POST URL을 알려주고, 이후 서버→클라이언트
메시지는 `message` 이벤트로, 클라이언트→서버 메시지는 그 POST URL로 받는 구조는
Servlet 버전과 동일한 MCP SSE 프로토콜이다. **tool/resource 등록, 세션·프로토콜
처리(McpServerSession, JSON-RPC framing)는 SDK 코드를 전혀 수정하지 않고
그대로 사용**하며, 바뀐 건 오직 이 transport 어댑터뿐이다.

## 실행

```bash
export DATABASE_URL=jdbc:postgresql://localhost:5433/riwonace
export DATABASE_USER=riwonace
export DATABASE_PASSWORD=riwonace
export OLLAMA_BASE_URL=http://localhost:11434
export SERVER_PORT=8081
./gradlew run
```

baseline과 동일하게 `docker-compose.yml`의 `postgres`(5433)·`ollama`(11434)
서비스에 연결하도록 기본값이 설정되어 있다.

## 테스트

```bash
./gradlew test
```

`SqlGuardTest`, `ToolResponseEncoderTest`, `HybridRetrievalScoreTest`는
mcp-server의 동일 파일을 **그대로 복사**한 것이다(패키지 선언만 변경) — 두
로직 모두 Spring 의존성이 전혀 없는 순수 Kotlin이라 바이트 단위로 재사용
가능했다. `ToolRegistrationContractTest`는 `RetrievalToolsContractTest`의
Ktor-port 대응 버전으로, `@Tool` 어노테이션 리플렉션 대신 등록된
`McpSchema.Tool` 이름 집합을 직접 검증한다(이 SDK에는 어노테이션 스캔 계층이
없음).

## 포팅 시 확인한 baseline 세부사항

- `vector_search`는 Go 포팅과 동일하게 Spring AI `PgVectorStore` 1.0.3의 실제
  동작(바이트코드 확인)을 따른다: `<=>`(COSINE_DISTANCE), `score = 1 - distance`,
  `similarityThreshold` 기본값 0.0(all-accept), overfetch `topK*5`(최대 20)건
  후 `lexicalCoverage` 내림차순 → 벡터 score 내림차순 재정렬.
- `vector_store` 테이블 스키마(`id uuid`, `content text`, `metadata json`,
  `embedding vector(n)`)는 Spring AI 자동 생성 스키마와 동일 — 별도 마이그레이션
  없이 기존 DB에 그대로 붙는다.
- `SqlGuard`, `ToolResponseEncoder`, `RetrievalTools`의 `kg_search`/
  `lexicalCoverage` 로직은 원본과 완전히 동일한 코드(복사·붙여넣기 수준)다 —
  이 부분들은 애초에 Spring이 아니라 순수 Kotlin으로 작성되어 있었기 때문이다.
- HikariCP는 baseline과 마찬가지로 별도 튜닝 없이 기본값을 사용한다
  (`application.yml`에 hikari.* 설정이 없다는 사실을 Go 포팅 때 이미 확인함).

## 검증

실제 Postgres + Ollama(`nomic-embed-text`)에 붙여 `tools/list`,
`resources/list`, `vector_search`, `run_sql`(정상+DML차단), `kg_search`,
`db://schema`를 MCP 클라이언트(Go SDK 기반 스모크 테스트)로 end-to-end
수동 검증했다. mcp-server-go 검증 때와 동일한 질의로 동일한 결과(같은 문서,
근접한 유사도 점수, 동일한 KG triple)를 반환함을 확인했다.
