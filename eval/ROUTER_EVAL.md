# 독립 라우터 평가기

`run-router-eval.py`는 PostgreSQL과 MCP 서버를 띄우지 않고 Ollama의 분류 프롬프트만
평가합니다. 정확한 라벨만 허용하고 호출 실패, 잘못된 출력, 혼동 행렬, 지연과 Git 메타데이터를
JSON에 기록합니다.

```bash
python3 eval/run-router-eval.py \
  --set eval/keyword-gap-eval.json \
  --prompt eval/router-prompts/current-ai.txt \
  --model gemma3:1b \
  --output eval/results/router-current-local.json
```

후보를 채택할 때는 `--fail-under 90`을 사용합니다. 이 평가는 라우팅만 측정하므로 최종 답변
정확도 주장을 대신하지 않습니다. 전체 시스템 결과는 기존 `run-eval.ps1`로 별도 측정합니다.

프롬프트를 수정할 때는 공개 개발셋 결과만 사용하고, 고정 뒤 별도 보류셋을 평가합니다.
평가 질문이나 정답을 프롬프트에 복사해 정확도를 올리는 것은 금지합니다.
