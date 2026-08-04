# Semantic graph aggregation

## Hypothesis

Local top-k triple retrieval is structurally weak for count, superlative, and global
project questions. Parse those intents into bounded graph operations and prepend a
compact deterministic summary before ordinary two-hop traversal.

Primary sources:

- Edge et al., *From Local to Global: A Graph RAG Approach to Query-Focused
  Summarization*: <https://www.microsoft.com/en-us/research/publication/from-local-to-global-a-graph-rag-approach-to-query-focused-summarization/>
- Wei et al., *Semantic Parsing for Question Answering over Knowledge Graphs*:
  <https://arxiv.org/abs/2401.06772>

## Change

- Count and rank `이슈보고` relations for support superlatives.
- Count distinct `담당한다` objects for customer-owner superlatives.
- Traverse `Product -> Client -> 프로젝트` without an arbitrary neighbor limit.
- Return a compact distinct leader list for global project-leader questions.
- Keep all SQL parameterized and all outputs bounded.
- Allow the full-stack evaluator to run route-specific subsets safely.

## Results

| Run | Scope | Answer accuracy | Route accuracy | Mean latency |
|---|---|---:|---:|---:|
| Baseline | GRAPH 10 | 50.0% (5/10) | 90.0% | n/a |
| Candidate v1 | Full 30 | 53.3% (16/30) | 93.3% | 5,341 ms |
| Candidate v3 | GRAPH 10 | 80.0% (8/10) | 90.0% | 4,797 ms |

The v3 route-specific run used the same Docker PostgreSQL, Ollama `gemma3:4b`,
`nomic-embed-text`, semantic router, and Spring MCP stack. It fixed project traversal,
global leader, and customer-owner ranking cases. One support answer retrieved the
correct count but omitted its product identifier; another case was routed to VECTOR.

Decision: keep the PR open because the target route improves by 30.0 percentage
points with zero request errors. Raw evidence is stored in
`eval/results/graph-only-semantic-aggregation-v3.json`.
