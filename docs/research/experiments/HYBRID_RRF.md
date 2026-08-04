# Hybrid dense + lexical retrieval (RRF)

## Hypothesis

Dense retrieval missed exact operational terms in the Company-X corpus. Combine the
dense and lexical rankings with Reciprocal Rank Fusion (RRF), following Cormack,
Clarke, and Buettcher (SIGIR 2009), without tuning incomparable score scales.

Primary source: <https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf>

## Change

- Retrieve ten dense candidates.
- Retrieve ten lexical candidates, ranked by matched domain-token count.
- Fuse both lists with `1 / (60 + rank)` and return the requested top-k.
- Parameterize all lexical terms; no query text is interpolated into SQL.

## Reproduction

```bash
python3 eval/run-full-eval.py \
  --set eval/keyword-gap-eval.json \
  --output eval/results/full-keyword-gap-hybrid-rrf-gemma4b-spring.json \
  --model-label gemma3:4b \
  --router-label semantic-ai \
  --mcp-label spring-hybrid-rrf
```

Environment: Docker PostgreSQL/pgvector, host Ollama `gemma3:4b` and
`nomic-embed-text`, Spring MCP server. Temperature is `0.0`.

## Result and decision

| Metric | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Full answer accuracy | 50.0% (15/30) | 50.0% (15/30) | 0.0%p |
| VECTOR answer accuracy | 50.0% (5/10) | 50.0% (5/10) | 0.0%p |
| Routing accuracy | 93.3% (28/30) | 93.3% (28/30) | 0.0%p |
| Mean latency | 5,503 ms | 5,897 ms | +394 ms |

The candidate does not improve the target metric and increases mean latency, so the
PR is closed rather than merged. The raw result remains attached for reproducibility.
