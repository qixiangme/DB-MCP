# 키워드 없는 질문 라우팅 연구 노트

## 문제 정의

이 프로젝트의 라우팅은 답변 생성보다 앞선 3분류 문제입니다.

- SQL: 구조화 데이터의 필터, 집계, 정렬, 비교
- VECTOR: 문서에 있는 절차, 설명, 사건, 정책
- GRAPH: 개체 사이의 소속, 사용, 담당, 연결 관계

기존 공개 키워드 제거 평가셋의 기준선은 기본 VECTOR 33.3%, 임베딩 43.3%,
`gemma3:1b` AI 분류 60.0%입니다. 목표는 특정 단어를 추가해 문항을 외우는 것이 아니라,
의도 설명과 다양한 예시로 의미를 분류하고 별도 보류 표현에서도 90% 이상을 재현하는 것입니다.

## 근거에서 가져온 설계 원칙

Anthropic의 에이전트 설계 글은 서로 다른 처리 범주가 있고 분류를 정확히 할 수 있을 때
라우팅 워크플로가 적합하며, 명확한 평가 기준이 있을 때 evaluator-optimizer 루프가 유용하다고
설명합니다. 이 프로젝트에서는 라우트를 먼저 고르고, 공개 개발셋 실패를 분석해 프롬프트를
수정한 뒤, 구현을 고정하고 보류셋을 한 번 평가하는 절차로 변환합니다.

OpenAI Evals/Graders 문서는 평가를 데이터 스키마와 채점 기준으로 명시하고, 모델 출력에
라벨을 부여하는 grader 구성을 제공합니다. 여기서는 외부 API에 데이터를 보내지 않고 같은
원칙만 적용해 `expectedRoute`, 정확 일치 파서, 호출 실패 수, 지연 시간을 구조화합니다.

의도 분류 연구에서는 다음 후보가 반복해서 나타납니다.

1. 검색한 유사 예시로 분류하는 retrieval-based few-shot 방식
2. 짧은 코드명이 아니라 의미가 풍부한 라벨 설명을 사용하는 방식
3. 예시 하나를 그대로 비교하기보다 클래스 단위 표현을 만드는 prototypical 방식
4. 혼동되는 라벨의 경계를 동적으로 더 명확하게 만드는 방식

현재 임베딩 폴백이 클래스별 예시의 최대 유사도 하나만 쓰는 점, AI 폴백이 클래스당 예시가
하나뿐인 점은 위 원칙과 맞지 않습니다. 우선 비용이 가장 작은 개선은 각 라벨의 데이터 형태와
연산을 명시하고, 클래스별로 다양한 예시와 반례를 균형 있게 제공하는 것입니다.

## 구현 후보와 분기 기준

| 후보 | 장점 | 위험 | 채택 기준 |
|---|---|---|---|
| 설명 강화 AI 분류 | 기존 1B와 API 재사용, 구현 작음 | 확률적 출력, 추가 지연 | 개발/보류 모두 90% 이상 |
| 클래스 프로토타입 임베딩 | 결정적, 생성 호출 없음 | 한국어 임베딩 품질 | AI보다 20%p 이내이며 지연 우세 |
| AI+임베딩 합의 | 오류 상관이 낮으면 강함 | 복잡도·두 모델 호출 | 단일 후보보다 유의미한 개선 |
| 불확실 시 다중 라우트 | recall과 안전한 복구 | 도구 비용과 컨텍스트 노이즈 | 답변 정확도 개선, 지연 한도 통과 |

다중 라우트는 라우팅 지표를 인위적으로 높일 수 있으므로 단일 정답 포함률만 보고 성공으로
판정하지 않습니다. 평균 라우트 수와 잘못 호출한 도구 수를 함께 보고합니다.

## 누수 방지 평가

- 개발셋과 보류셋은 동일 원문의 바꿔쓰기가 양쪽에 흩어지지 않도록 의미 그룹 단위로 나눕니다.
- 런타임 프롬프트에는 평가 질문, ID, 정답을 포함하지 않습니다.
- 프롬프트를 보류셋 결과를 본 뒤 수정하면 그 세트는 더 이상 보류셋이 아닙니다.
- 30/30은 그 파일에 대한 관측 결과이며 새로운 사용자 질문 100% 보장이 아닙니다.
- 라우팅과 최종 답변 정확도를 분리합니다. 올바른 도구를 골라도 검색·SQL·생성에서 실패할 수 있습니다.

## 출처

- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- OpenAI, [Evals API](https://platform.openai.com/docs/api-reference/evals)
- OpenAI, [Graders API](https://platform.openai.com/docs/api-reference/graders)
- Yu et al., [Few-shot Intent Classification and Slot Filling with Retrieved Examples](https://aclanthology.org/2021.naacl-main.59/)
- Qu et al., [Few-Shot Intent Classification by Gauging Entailment Relationship Between Utterance and Semantic Label](https://aclanthology.org/2021.nlp4convai-1.2/)
- Krone et al., [Learning to Classify Intents and Slot Labels Given a Handful of Examples](https://aclanthology.org/2020.nlp4convai-1.12/)
- Park et al., [MIRAGE: A Metric-Intensive Benchmark for RAG Evaluation](https://arxiv.org/abs/2504.17137)
- Ru et al., [RAGChecker](https://proceedings.neurips.cc/paper_files/paper/2024/hash/27245589131d17368cccdfa990cbf16e-Abstract-Datasets_and_Benchmarks_Track.html)

최종 확인일: 2026-08-04.
