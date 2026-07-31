# Riwonace MCP 지능형 데이터 플랫폼

MCP(Model Context Protocol) 표준 규격만으로 PostgreSQL과 온프레미스 소형 LLM(기본 1B)을 연결해,
일상어 질문에 스스로 정답을 찾아주는 지능형 AI 검색 비서입니다.

- **Stack**: Kotlin · Spring Boot 3.5 · Spring AI 1.0 (MCP Server/Client) · PostgreSQL 16 + pgvector · Ollama
- **설계 문서**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **경량·안정성 원칙 (심사 기준 대응)**: [LIGHT-AND-STABLE.md](./LIGHT-AND-STABLE.md)

## 구성

| 모듈 | 포트 | 역할 |
|---|---|---|
| `mcp-server` | 8081 | MCP 표준 도구 서버 — `vector_search` / `run_sql` / `kg_search` / `get_schema` |
| `agent-app`  | 8080 | AI 에이전트 — 규칙 기반 라우터, NL2SQL, TACC 컨텍스트 큐레이션, 답변 생성 |
| PostgreSQL + pgvector | 5433 | 문서 벡터 · 관계형 데이터 · 지식 그래프(triple) 통합 저장소 |
| Ollama | 11434 | `gemma3:1b`(추론, 기본) + `nomic-embed-text`(임베딩) |

저사양 PC 기준 필요한 모델 용량은 **약 1.1GB**(gemma3:1b 815MB + nomic-embed-text 274MB)입니다.
사양이 되면 환경변수 하나로 상위 모델로 교체합니다: `OLLAMA_MODEL=qwen2.5:3b` (모델 선택표는 [LIGHT-AND-STABLE.md](./LIGHT-AND-STABLE.md) 참고)

## 빠른 시작

```bash
# 1. 인프라 기동 (PostgreSQL + Ollama)
docker compose up -d

# 2. 모델 다운로드 (최초 1회)
docker exec riwonace-ollama ollama pull gemma3:1b
docker exec riwonace-ollama ollama pull nomic-embed-text

# 3. MCP 서버 기동 (기동 시 시드 문서 10건 자동 임베딩)
./gradlew :mcp-server:bootRun

# 4. 에이전트 기동 (별도 터미널)
./gradlew :agent-app:bootRun
```

## 사용 예시

```bash
# 개념 질문 → vector_search 라우팅
curl -s -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" \
  -d '{"question": "MCP가 기존 RAG보다 뭐가 좋아?"}'

# 집계 질문 → NL2SQL + run_sql 라우팅
curl -s -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" \
  -d '{"question": "플랫폼팀 직원의 평균 급여는 얼마야?"}'

# 관계 질문 → kg_search 라우팅
curl -s -X POST http://localhost:8080/api/chat -H "Content-Type: application/json" \
  -d '{"question": "air는 누가 개발했어?"}'

# MCP 연결 상태 / 노출된 도구 확인
curl -s http://localhost:8080/api/tools

# 시드 문서 재임베딩 (Ollama를 나중에 켠 경우)
curl -s -X POST http://localhost:8081/admin/ingest
```

응답에는 답변과 함께 라우팅 결과(`routes`), 호출된 MCP 도구(`toolCalls`),
사용한 컨텍스트 출처(`contextSources`), 지연 시간(`latencyMs`)이 포함되어
시스템의 판단 과정을 투명하게 확인할 수 있습니다.

## 테스트

```bash
./gradlew test
```

라우터 규칙, TACC 큐레이션, SQL 읽기 전용 가드(인젝션 차단)에 대한 단위 테스트가 실행됩니다.
