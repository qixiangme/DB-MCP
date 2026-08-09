# MCP 스키마 기반 NL2SQL grounding 실험

연결 이슈: #45

## 결론

`gemma3:1b`에서는 스키마 원문을 정돈하는 것만으로 정확도가 오르지 않았다. 실제 병목은
동적 few-shot 예시가 현재 DB에 없는 식별자를 가르치고, 서로 다른 세 예시가 한 SQL에
섞이는 현상이었다. MCP 스키마를 구조화하고 스키마 유효 예시 중 가장 가까운 하나만
제공했을 때 공식 SQL 답변 정확도는 10.0%에서 40.0%, 보류 SQL은 33.3%에서 44.4%로
상승했다.

## 근거가 된 연구

- [RAT-SQL](https://aclanthology.org/2020.acl-main.677/)은 스키마 항목과 질문의 관계를
  명시적으로 모델링해 schema linking과 구조 인코딩의 중요성을 보였다.
- [Global Reasoning over Database Structures](https://aclanthology.org/P19-1448/)는 DB 구조
  인코딩으로 Spider 정확도를 33.8%에서 39.4%로 높였다.
- [PET-SQL](https://arxiv.org/abs/2403.09732)은 스키마와 cell value를 함께 제공하고
  프롬프트를 정제하는 방식의 효과를 보고했다.
- [TCSR-SQL](https://arxiv.org/abs/2407.01183)은 table-content-aware 값 활용이
  Text-to-SQL 실행 정확도를 개선한다고 보고했다.
- [SQLPrompt](https://arxiv.org/abs/2311.02883)은 실행 결과를 이용한 일관성 선택이
  생성 후보의 오류를 줄일 수 있음을 보였다. 현재 구현의 실행 후 재시도와 연결되는
  후속 후보지만 이번 PR에서는 변수를 하나로 제한했다.

## 실패 분석

최신 `main`의 generic 예시에는 실제 스키마와 다른 `tickets`, `products.price`,
`contracts.is_active` 등이 있었다. `gemma3:1b`은 스키마보다 예시의 식별자를 우선
복사해 `relation tickets does not exist`, `column is_active does not exist` 같은 오류를
반복했다. 실행 오류를 재입력해도 temperature 0에서 같은 SQL을 재생성하는 경우가 많았다.

실험 중 폐기한 후보도 보존한다.

1. 스키마 JSON을 TABLE/FOREIGN KEYS/KNOWN VALUES로만 분리: 공식 정확도 10.0%로 동률.
2. 스키마 유효 예시를 3개 선택: 서로 다른 패턴을 섞어 공식 정확도 0.0%로 회귀.
3. 스키마 유효 예시를 1개 선택: 공식 40.0%, 보류 44.4%로 개선.

공개/보류 질문이나 정답 키워드는 런타임 코드와 프롬프트에 복사하지 않았다. 예시는
실제 테이블·컬럼·외래키를 사용하되 평가 문항과 다른 엔티티와 표현으로 작성했다.

## 변경 사항

- MCP `get_schema`에 `information_schema` 기반 외래키 관계와 스키마 전용 출력 한도를 추가했다.
- TABLE, FOREIGN KEYS, KNOWN COLUMN VALUES를 의미 영역별로 분리해 값 힌트를 식별자로
  오인하지 않도록 했다.
- 최신 `main`의 `SchemaLinker`가 실제 `valueHints` 응답 구조와 달랐던 계약 불일치를 수정했다.
- generic few-shot을 Company-X 스키마에 유효한 예시로 교체하고 top-k를 3에서 1로 줄였다.
- JDBC 예외의 최심 원인을 MCP 오류 응답에 포함해 재시도 피드백을 구체화했다.

## 재현 프로토콜

| 항목 | 값 |
|---|---|
| 기준 커밋 | `788219ccaf666ca16da4df36183c2058b7cb84c3` |
| 후보 커밋 | `518628f03767bcbca8402338a461e0240c335da2` |
| 모델 | Ollama `gemma3:1b`, temperature 0 |
| 라우터/MCP | adaptive TF-IDF / Spring AI |
| 반복 | 문항별 3회 |
| 채점기 | `eval/run-full-eval-v2.py` 2.0 |
| 필터 | `--route-filter SQL` |

```bash
python3 eval/run-full-eval-v2.py \
  --set eval/official-eval.json --base-url http://localhost:8080 \
  --reps 3 --timeout 180 --route-filter SQL \
  --model-label gemma3:1b --router-label adaptive --mcp-label spring-ai
```

## 결과

| 분할 | 지표 | 기준선 | 후보 | 변화 |
|---|---|---:|---:|---:|
| 공식 SQL 10문항 × 3 | 답변 정확도 | 10.0% | 40.0% | +30.0%p |
| 공식 SQL 10문항 × 3 | 라우팅 적중률 | 100.0% | 100.0% | 0.0%p |
| 공식 SQL 10문항 × 3 | 평균 지연 | 2409ms | 1956ms | -18.8% |
| 보류 SQL 9문항 × 3 | 답변 정확도 | 33.3% | 44.4% | +11.1%p |
| 보류 SQL 9문항 × 3 | 라우팅 적중률 | 100.0% | 100.0% | 0.0%p |
| 보류 SQL 9문항 × 3 | 평균 지연 | 2391ms | 2895ms | +21.1% |
| 양쪽 | 오류 수 | 0 | 0 | 0 |

보류셋 지연 회귀는 숨기지 않는다. 후보가 `H-MIX-04`, `H-MIX-05`를 새로 맞히면서
후자는 SQL과 GRAPH 두 경로를 모두 수행했고, 정확도와 함께 작업량도 증가했다. 따라서
이 PR은 정확도 우선 후보이며, 지연 개선을 일반화해 주장하지 않는다.

원시 결과:

- `eval/results/schema-grounding-main-official-sql.json`
- `eval/results/schema-grounding-candidate-official-sql.json`
- `eval/results/schema-grounding-main-holdout-sql.json`
- `eval/results/schema-grounding-candidate-holdout-sql.json`

## 남은 실패와 후속 후보

공식셋에서는 복합 join/집계 문항 N1, N3, N6, N10 등이 남았다. 다음 실험은 SQL을 여러
개 생성한 뒤 실행 가능성과 결과 일관성으로 고르는 execution-guided selection이다.
다만 호출 수와 지연이 늘기 때문에 별도 이슈와 분리된 벤치마크로 검증해야 한다.
