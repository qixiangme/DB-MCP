# 논문 기반 벤치마크 개선 아이디어 10선

> 2026-08-09 조사 결과. 각 아이디어는 최신 논문에 근거하며, 측정 가능한 개선 가설과 구현 방향을 포함한다.

## 1. Adaptive RAG Routing (RAGRouter-Bench 기반)

**논문**: [RAGRouter-Bench: A Dataset and Benchmark for Adaptive RAG Routing](https://arxiv.org/abs/2602.00296) (2026)

**핵심 아이디어**: TF-IDF + SVM 분류기로 질문 유형(factual/reasoning/summarization)을 분류하고, 각 유형에 맞는 검색 전략을 선택한다.

**현재 문제**: RuleBasedRouter는 키워드 기반으로 작동해 의미적으로 동일한 질문도 표현에 따라 다른 라우트로 분류된다.

**가설**: TF-IDF 기반 분류기가 키워드 매칭보다 라우팅 정확도를 5%p 이상 개선할 수 있다.

**구현**:
- `sklearn.feature_extraction.text.TfidfVectorizer`로 질문 임베딩
- `sklearn.svm.SVC`로 SQL/VECTOR/GRAPH 3-class 분류
- 학습 데이터: official-eval.json + keyword-gap-eval.json의 60문항

**측정**: 키워드 미매칭 질문에서 라우팅 정확도 (현재 93.3% → 목표 98%+)

---

## 2. Hybrid Dense-Sparse Retrieval (RRF 기반)

**논문**: [From BM25 to Corrective RAG: Benchmarking Retrieval](https://arxiv.org/pdf/2604.01733) (2026)

**핵심 아이디어**: BM25 스파스 검색과 벡터 밀집 검색을 Reciprocal Rank Fusion으로 결합하면 15-30% 리콜 향상.

**현재 문제**: `vector_search`만 사용해 정확한 용어 매칭이 필요한 질문(제품명, 고객사명)에서 리콜이 낮다.

**가설**: BM25 + 벡터 검색 RRF 결합이 VECTOR 경로 답변 정확도를 10%p 이상 개선할 수 있다.

**구현**:
- PostgreSQL `ts_rank` + `tsvector`로 BM25 유사 검색 추가
- `vector_search` 결과와 BM25 결과를 RRF로 결합: `1/(k+rank)`
- k=60 사용 (논문 권장값)

**측정**: VECTOR 경로 답변 정확도 (현재 50.0%)

---

## 3. Lost-in-the-Middle 완화 (Position-Aware Context)

**논문**: [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172) (Liu et al., 2023)

**핵심 아이디어**: LLM은 컨텍스트 앞과 뒤의 정보를 잘 활용하고 중간은 무시한다. 관련도 높은 항목을 맨 앞과 맨 뒤에 배치한다.

**현재 상태**: `ContextCurator`가 이미 구현했으나, 벤치마크로 효과를 정량화하지 않았다.

**가설**: 위치 인지 배치가 없을 때 대비 답변 정확도 3%p 이상 개선 효과가 있다.

**구현**:
- A/B 테스트: 위치 인지 배치 ON vs OFF
- 컨텍스트 3개 이상일 때만 적용

**측정**: 전체 답변 정확도 차이

---

## 4. Self-Corrective SQL (Self-RAG 영감)

**논문**: [Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection](https://proceedings.iclr.cc/paper_files/paper/2024/hash/25f7be9694d7b32d5cc670927b8091e1-Abstract-Conference.html) (ICLR 2024)

**핵심 아이디어**: 생성 결과를 자가 비평하고 필요시 재시도한다.

**현재 상태**: `AgentService`가 run_sql 오류/0행 시 1회 재시도하지만, SQL 구문 오류는 잡지 못한다.

**가설**: SQL 구문 검증 + 결과 검증 2단계 자가수정이 SQL 경로 답변 정확도를 5%p 이상 개선할 수 있다.

**구현**:
- 1단계: SQL 생성 후 `EXPLAIN` 실행으로 구문 검증
- 2단계: 결과가 비거나 예상 범위 벗어나면 피드백과 함께 재생성
- 최대 2회 재시도

**측정**: SQL 경로 답변 정확도 (현재 50.0%)

---

## 5. Query Decomposition (IRCoT 영감)

**논문**: [Interleaving Retrieval with Chain-of-Thought Reasoning](https://arxiv.org/abs/2212.10509) (Trivedi et al., 2023)

**핵심 아이디어**: 복잡한 질문을 하위 질문으로 분해하고 각각에 대해 검색-추론을 반복한다.

**현재 문제**: 멀티홉 질문("Client-A가 사용하는 제품의 카테고리는?")에서 한 번의 검색으로 필요한 정보를 모두 얻지 못한다.

**가설**: 질문 분해 후 순차 검색이 멀티홉 질문 답변 정확도를 15%p 이상 개선할 수 있다.

**구현**:
- LLM으로 질문 분해: "1. Client-A가 사용하는 제품은? 2. 그 제품의 카테고리는?"
- 각 하위 질문에 대해 독립적으로 라우팅-검색-답변
- 중간 답변을 다음 질문의 컨텍스트로 전달

**측정**: multi-hop 타입 질문 답변 정확도

---

## 6. Schema Linking Enhancement (SchemaGraphSQL 영감)

**논문**: [SchemaGraphSQL: Efficient Schema Linking with Pathfinding](https://arxiv.org/pdf/2505.18363) (2025)

**핵심 아이디어**: 질문의 엔티티를 스키마 테이블/컬럼과 명시적으로 연결한다.

**현재 문제**: 소형 모델이 "플랫폼팀"을 `dept`나 `department` 중 어느 컬럼에 매칭할지 혼동한다.

**가설**: 질문에서 엔티티를 추출하고 스키마 힌트와 매칭하면 NL2SQL 정확도가 10%p 이상 개선된다.

**구현**:
- `get_schema`의 valueHints를 활용해 질문의 값과 매칭
- 매칭된 테이블.컬럼을 프롬프트에 명시
- 예: "질문에 '플랫폼팀'이 있음 → departments.name = '플랫폼팀' 사용"

**측정**: SQL 경로 답변 정확도

---

## 7. GraphRAG Community Summarization

**논문**: [GraphRAG: From Local to Global](https://microsoft.github.io/graphrag/) (Microsoft, 2024)

**핵심 아이디어**: 지식 그래프의 커뮤니티(클러스터)별 요약을 미리 생성해 전역 질문에 답한다.

**현재 문제**: `kg_search`는 토큰 매칭 기반 2홉 탐색만 지원해 "전체 프로젝트 리더 목록" 같은 전역 질문에 약하다.

**가설**: 커뮤니티 요약이 GRAPH 경로 답변 정확도를 20%p 이상 개선할 수 있다.

**구현**:
- 지식 그래프에서 Leiden 알고리즘으로 커뮤니티 탐지
- 각 커뮤니티에 대해 요약 생성 후 저장
- 전역 질문 감지 시 커뮤니티 요약 검색

**측정**: GRAPH 경로 답변 정확도 (현재 50.0%, PR #31에서 80% 달성)

---

## 8. Few-Shot Example Selection

**논문**: [Instructional Prompt Optimization for Few-Shot LLM](https://arxiv.org/pdf/2509.09066) (2025)

**핵심 아이디어**: 질문과 유사한 예시를 동적으로 선택해 프롬프트에 포함한다.

**현재 상태**: NL2SQL 프롬프트에 고정된 2개 예시 사용.

**가설**: 질문 임베딩 유사도로 관련 예시 3개를 선택하면 NL2SQL 정확도가 5%p 이상 개선된다.

**구현**:
- SQL 예시 풀(10-20개) 구축: 질문 + 정답 SQL
- 질문 임베딩으로 가장 유사한 예시 3개 검색
- 프롬프트에 동적 삽입

**측정**: SQL 경로 답변 정확도

---

## 9. Reranker Integration (Cross-Encoder)

**논문**: [RAG Reranking: Improving Retrieval Quality with Cross-Encoders](https://bigdataboutique.com/blog/rag-reranking-improving-retrieval-quality-with-cross-encoders)

**핵심 아이디어**: bi-encoder로 후보를 검색하고, cross-encoder로 재순위를 매긴다.

**현재 문제**: `vector_search`가 상위 4개를 반환하지만 최적의 문서가 5-10위에 있을 수 있다.

**가설**: top-10 검색 후 cross-encoder 재순위를 매기면 VECTOR 경로 답변 정확도가 8%p 이상 개선된다.

**구현**:
- `vector_search` topK를 10으로 증가
- 로컬 cross-encoder 모델로 질문-문서 쌍 점수 계산
- 상위 4개만 컨텍스트에 포함

**측정**: VECTOR 경로 답변 정확도

---

## 10. Cost-Aware Routing (CA-RAG 영감)

**논문**: [Cost-Aware Query Routing in RAG](https://arxiv.org/pdf/2606.02581) (2026)

**핵심 아이디어**: 질문 복잡도에 따라 검색 깊이를 조절해 비용과 품질을 최적화한다.

**현재 상태**: 모든 질문에 동일한 검색 전략 적용.

**가설**: 간단한 질문은 얕은 검색, 복잡한 질문은 깊은 검색으로 지연시간 30% 감소하면서 품질 유지.

**구현**:
- 질문 복잡도 분류: simple(단일 사실) / medium(집계) / complex(멀티홉)
- simple: topK=2, medium: topK=4, complex: topK=8 + 재순위
- 복잡도별 예산 차등 적용

**측정**: 평균 지연시간 vs 답변 정확도 트레이드오프

---

## 우선순위 및 구현 순서

| 순위 | 아이디어 | 예상 효과 | 구현 난이도 | 의존성 |
|------|---------|----------|------------|--------|
| 1 | Query Decomposition | 높음 | 중 | 없음 |
| 2 | Self-Corrective SQL | 높음 | 낮음 | 없음 |
| 3 | Schema Linking | 중상 | 낮음 | 없음 |
| 4 | Hybrid Retrieval (RRF) | 중상 | 중 | 없음 |
| 5 | Few-Shot Selection | 중 | 낮음 | 없음 |
| 6 | GraphRAG Community | 높음 | 높음 | PR #31 |
| 7 | Adaptive Routing | 중 | 중 | 학습 데이터 |
| 8 | Reranker | 중 | 중 | 모델 다운로드 |
| 9 | Lost-in-Middle 검증 | 낮음 | 낮음 | 없음 |
| 10 | Cost-Aware Routing | 중 | 중 | 복잡도 분류기 |

## 참고 문헌

1. RAGRouter-Bench (2026): https://arxiv.org/abs/2602.00296
2. GraphRAG (Microsoft, 2024): https://microsoft.github.io/graphrag/
3. Self-RAG (ICLR 2024): https://proceedings.iclr.cc/paper_files/paper/2024/hash/25f7be9694d7b32d5cc670927b8091e1-Abstract-Conference.html
4. IRCoT (2023): https://arxiv.org/abs/2212.10509
5. Lost in the Middle (2023): https://arxiv.org/abs/2307.03172
6. SchemaGraphSQL (2025): https://arxiv.org/pdf/2505.18363
7. CA-RAG (2026): https://arxiv.org/pdf/2606.02581
