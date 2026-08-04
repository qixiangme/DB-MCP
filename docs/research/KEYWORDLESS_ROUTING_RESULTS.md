# 키워드 없는 라우팅 실험 결과

측정일은 2026-08-04이며, 최종 구현은 `ROUTER_FALLBACK=semantic-ai`, 모델은
`gemma3:4b`, temperature는 0입니다. PostgreSQL과 MCP를 사용하지 않는 독립 라우터
평가기에서 실제 구현 프롬프트를 호출했습니다.

## 결과

| 평가셋 | 정확도 | SQL | VECTOR | GRAPH | 평균 분류 지연 |
|---|---:|---:|---:|---:|---:|
| 공개 키워드 제거 30문항 | **93.3% (28/30)** | 9/10 | 10/10 | 9/10 | 1,608ms |
| 프롬프트 고정 후 보류 30문항 | **96.7% (29/30)** | 10/10 | 10/10 | 9/10 | 1,618ms |

보류셋은 `check-keyword-gap.py`로 현재 `RuleBasedRouter`의 96개 결정 키워드와 교집합이
없음을 확인했습니다. 원시 결과는 다음 파일에 있습니다.

- `eval/results/keyword-gap-semantic-gemma4b.json`
- `eval/results/keyword-gap-holdout-semantic-gemma4b.json`

## 후보 비교

같은 공개 30문항을 독립 평가기로 실행한 값입니다. 저장소에 이미 있던 전체 앱 기록
(기본 33.3%, 임베딩 43.3%, 기존 AI 60.0%)과 달리 아래는 분류 호출만 격리한 수치라
지연과 답변 정확도를 직접 비교하지 않습니다.

| 모델·프롬프트 | 라우팅 적중률 |
|---|---:|
| gemma3:1b · 기존 3-shot | 63.3% |
| gemma3:1b · 의미 설명 | 63.3% |
| qwen2.5:3b · 기존 3-shot | 73.3% |
| qwen2.5:3b · 의미 설명 | 83.3% |
| gemma3:4b · MCP 도구 계약 | **93.3%** |

긴 스키마 전체를 주입한 후보는 qwen2.5:3b에서 73.3%로 회귀했습니다. 클래스 설명을
무조건 늘리는 대신 실제 도구가 소유한 데이터 형태와 중첩 시 우선순위만 간결하게 준 후보를
채택했습니다.

## 실패 분석과 한계

- 공개 K-N6: 고객-프로젝트가 SQL의 `projects.client_id`와 그래프의 `HAS_PROJECT` 양쪽에 존재해 GRAPH로 분류했습니다.
- 공개 K-G9: 제품 사용 중 겪은 상황이 장애 문서와 `REPORTED_ISSUE` 양쪽에 존재해 VECTOR로 분류했습니다.
- 보류 H-G9: 고객 계정 관리 수 비교가 관계 간선 집계보다 일반 집계로 읽혀 SQL로 분류했습니다.

따라서 이 결과는 100%가 아닙니다. 93.3%와 96.7%는 두 평가 파일에 대한 관측값이지 모든
새 질문의 정확도 보장이 아닙니다. 100%를 만들기 위해 평가 문장을 프롬프트에 복사하지
않았습니다. 다음 개선은 단일 라벨을 강제하기보다 중첩 라우트의 소유권을 데이터 계약에 더
명시하거나, 불확실할 때 비용 한도 안에서 두 도구를 호출하고 별도의 precision 지표를 함께
측정하는 것입니다.

이 평가는 라우팅만 격리합니다. 최종 답변 정확도에는 검색 recall, NL2SQL, 문맥 큐레이션,
생성 모델이 추가로 영향을 줍니다. 당시 로컬 Docker 엔진이 실행 중이 아니어서 PostgreSQL과
MCP가 필요한 전체 답변 벤치마크는 새 결과로 재실행하지 않았습니다. 기존 전체 앱 결과와
혼동하지 않도록 보고 범위를 분리합니다.

## 재현

```bash
ollama pull gemma3:4b
python3 eval/check-keyword-gap.py eval/keyword-gap-holdout.json
python3 eval/run-router-eval.py \
  --set eval/keyword-gap-eval.json \
  --prompt agent-app/src/main/resources/router/semantic-ai-prompt.txt \
  --model gemma3:4b --fail-under 90 \
  --output eval/results/reproduced-public.json
python3 eval/run-router-eval.py \
  --set eval/keyword-gap-holdout.json \
  --prompt agent-app/src/main/resources/router/semantic-ai-prompt.txt \
  --model gemma3:4b --fail-under 90 \
  --output eval/results/reproduced-holdout.json
```
