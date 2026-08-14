# 로컬 MCP 지연시간 최적화 검토 결과

## 결론

현재 기본 경로에서 가장 큰 비용은 MCP 자체보다 Ollama의 프롬프트 처리와 생성이다. 따라서
MCP 서버를 AIR로 교체하거나 전송 계층을 복잡하게 바꾸는 것보다, 모델을 계속 메모리에 두고
불필요한 모델 왕복과 컨텍스트 재처리를 줄이는 편이 이 시스템에 맞다.

이번 검토에서는 다음 네 가지 후보를 같은 기준으로 비교 대상으로 삼았다.

| 후보 | 예상 효과 | 현재 상태 | 판정 |
|---|---|---|---|
| 모델 상주·기동 워밍업 | 첫 요청 콜드 스타트 제거 | `docker-compose.yml`의 `OLLAMA_KEEP_ALIVE=-1`, `ModelWarmup`으로 이미 적용 | 유지 |
| 스키마 캐시·결정적 SQL 계획 | SQL 경로의 반복 MCP/LLM 호출 감소 | `McpGateway` 24시간 캐시, `DeterministicSqlPlanner` 적용 | 유지 |
| 라우트 병렬 실행 | 복합 질문에서 독립 검색의 합산 지연 감소 | `AgentServiceV2` DAG 레벨 병렬 실행 | 유지 |
| MCP 전송 교체·무제한 병렬화 | 네트워크/락 비용 감소 가능 | 단일 로컬 SSE와 세션 보호를 유지 | 보류 |

초기 공식 비교에서 AIR의 평균 지연이 낮게 관측되었지만, 답변 정확도는 문항별로 동일했고
CPU 모델 생성 시간의 분산이 MCP 호출 시간보다 컸다. 따라서 그 결과만으로 프레임워크를
교체할 근거는 없다.

## 구현에 반영된 최적화

1. Ollama 컨테이너는 `OLLAMA_KEEP_ALIVE=-1`, Flash Attention, `q8_0` KV cache를 사용한다.
2. 애플리케이션 기동 직후 1토큰 워밍업을 비동기로 실행한다. 워밍업 실패가 서버 기동을
   막지 않도록 했다.
3. `db://schema`는 MCP Resource로 한 번 읽은 뒤 캐시하고, 결정적 SQL 패턴은 LLM을 호출하지
   않는다.
4. 실행 계획의 같은 의존성 레벨에 있는 VECTOR/GRAPH/SQL 노드는 병렬로 실행한다. 단일
   MCP 세션의 요청 ID 안전성을 위해 게이트웨이의 세션 보호는 유지한다.
5. 증거 예산은 2,400자로 제한하고, SQL few-shot은 한 개만 선택해 생성 프롬프트의 재처리량을
   제한한다.

## 보류한 후보와 이유

### stdio 전환

MCP 공식 아키텍처 문서는 같은 머신의 로컬 프로세스에는 stdio가 네트워크 오버헤드가 없어
효율적이라고 설명한다. 그러나 현재 과제는 독립 MCP 서버를 교체하는 계약을 검증해야 하며,
stdio를 기본값으로 만들면 Spring AI/AIR 비교와 운영 분리가 사라진다. 로컬 단일 프로세스
배포 프로필에서 별도 측정할 후보로 남긴다.

### 도구 정의 전체 사전 주입

MCP 클라이언트 가이드는 모든 도구 정의를 매 요청에 넣으면 토큰·지연·성능 비용이 생길 수
있으므로 점진적 발견을 권장한다. 현재 에이전트는 MCP tool callback을 비활성화하고, 필요한
실행 노드만 직접 호출하므로 이 비용을 이미 피한다. API를 다시 tool-calling 방식으로 바꾸는
것은 현재 경로보다 빠르다는 증거가 없어 채택하지 않았다.

### 비동기 task 전환

장시간 도구에는 MCP Tasks가 적합하지만, 현재 세 도구는 짧은 검색·읽기 요청이다. 비동기
핸들만 추가하면 사용자가 결과를 폴링해야 하므로 p50 응답시간을 줄이지 않는다.

## 재현 방법

```bash
docker compose up -d postgres ollama
./gradlew :mcp-server:bootRun --no-daemon
./gradlew :agent-app:bootRun --no-daemon
python3 eval/run-full-eval-v2.py \
  --set eval/official-eval.json --reps 3 --timeout 300 \
  --output eval/results/latency-candidate.json \
  --model-label gemma3:1b --mcp-label spring-ai
```

비교 시 모델, 임베딩 모델, seed, 데이터베이스 상태, 반복 수를 고정하고 답변 정확도와
라우팅 회귀가 없는지 먼저 확인한다. 지연시간은 평균만 사용하지 않고 p50/p95를 함께 기록한다.

## 참고 자료

- [MCP client best practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices)
- [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP Tasks](https://modelcontextprotocol.io/extensions/tasks/overview)
- [MCP JSON-RPC batching](https://modelcontextprotocol.io/specification/2025-03-26/basic/index)
- [Ollama MLX performance: prefix caching and agent workflows](https://ollama.com/blog/mlx-performance)
- [Ollama context length and offload guidance](https://docs.ollama.com/context-length)

