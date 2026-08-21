# agent-app-ktor

`agent-app`(Kotlin/Spring AI, Architecture v2 경로)의 1:1 Ktor 포팅. 라우팅·
NL2SQL·answerability gate·evidence 최적화·recovery policy 로직을 임의로
개선하지 않고 재현한다. 상세 배경은 저장소 루트 이슈
[#100](https://github.com/qixiangme/DB-MCP/issues/100),
[#102](https://github.com/qixiangme/DB-MCP/issues/102)을 참고.

## 스코프

`AgentServiceV2`(현재 production 경로, `agent.v2.enabled=true` 기본값)만
대상으로 한다. v1(`AgentService`)은 포팅하지 않는다 (agent-app-go와 동일한
스코프 결정).

## 이 포팅의 특징: 대부분 코드가 원본과 바이트 단위로 동일하다

agent-app의 순수 로직 컴포넌트(`RuleBasedRouter`, `DeterministicSqlPlanner`,
`QueryProfiler`, `ExecutionPlanner`, `ModelEscalator`, `EvidenceOptimizer`,
`RecoveryPolicy`, `SchemaLinker`, `FewShotSelector`, `SchemaPromptFormatter`,
`PostgresSqlNormalizer`, `StructuredEvidenceFormatter`, `RouteQuestionProjector`,
`McpGateway`)는 Spring 프레임워크 자체에 의존하지 않고 `@Component`/`@Value`
어노테이션만 걸려 있었다. 이 어노테이션들을 제거하고 패키지 선언만 바꾸면
원본 코드가 그대로 컴파일된다 — Go 포팅과 달리 언어가 같기 때문에 가능한
지름길이며, 정확히 "언어는 그대로, 프레임워크만 교체"라는 이번 실험의
목적에 부합한다.

Spring 의존이 실제로 있던 3곳만 새로 작성했다:
- `AnswerabilityGate`의 `ChatClient` 생성자 파라미터 (원본에서도 `verify()`
  안에서 실제로 읽히지 않는 죽은 필드 — 제거해도 동작 동일)
- `AgentServiceV2`의 Spring AI `ChatClient` 호출부 → `OllamaChatClient`
  (순수 `java.net.http` 기반)
- `ChatController`(Spring MVC) → Ktor 라우팅

## 실행

```bash
export MCP_SERVER_URL=http://localhost:8081   # mcp-server, mcp-server-go, mcp-server-ktor 무엇이든
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=gemma3:1b
export SERVER_PORT=8080
./gradlew run
```

## API

- `POST /api/chat`, `POST /api/chat/v2?trace=true` — baseline `ChatController`와 동일 응답 shape
- `GET /api/tools`, `GET /api/v2/status`

## 테스트

```bash
./gradlew test
```

`RuleBasedRouterTest`, `DeterministicSqlPlannerTest`, `QueryProfilerTest`,
`ModelEscalatorTest`, `EvidenceOptimizerTest`, `AnswerabilityGateTest`,
`RecoveryPolicyTest`, `SchemaLinkerTest`, `FewShotSelectorTest`,
`SchemaPromptFormatterTest`, `PostgresSqlNormalizerTest`,
`StructuredEvidenceFormatterTest`, `RouteQuestionProjectorTest`,
`McpGatewayTest` 총 89개 오라클 테스트를 **원본과 동일한 파일**로 그대로
복사해 실행하며, 전부 통과한다.

## 검증

실제 `mcp-server-ktor` + Postgres + Ollama(`gemma3:1b`, `qwen2.5:3b`,
`nomic-embed-text`)에 붙여 SQL/VECTOR/GRAPH 세 라우트 모두 end-to-end
수동 검증했다. agent-app-go 검증 때와 동일한 질의로 동일하거나 매우
근접한 결과(같은 SQL 답, 같은 문서 소스, 모델 재에스컬레이션 발생 여부까지
일치)를 확인했다.
