# Claude Code-inspired Stop Hook recovery

## Source pattern

The user-provided Claude Code guide describes a query loop that withholds recoverable
errors, runs Stop Hooks after a response, and repeats tool/action/verification steps
before exposing the final result. This experiment applies that architecture to the
DB-MCP answer stage rather than copying any source code.

Related official guidance:

- Anthropic, *Building effective agents* (evaluator-optimizer workflow):
  <https://www.anthropic.com/engineering/building-effective-agents>
- Anthropic, *Demystifying evals for AI agents*:
  <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>

## Change

1. Generate the normal context-grounded draft.
2. Run a read-only completion validator that emits only `PASS` or `RETRY`.
3. On `RETRY`, withhold the draft and regenerate once from the same evidence while
   explicitly preserving requested identifiers, numbers, and lists.
4. Record the retry in `toolCalls` as `answer_stop_hook(retry)`.

The loop is bounded to one retry to prevent runaway cost and latency.

## Benchmark

Docker PostgreSQL/pgvector, Ollama `gemma3:4b` + `nomic-embed-text`, semantic router,
Spring MCP, temperature `0.0`, one pass over 30 keyword-gap questions.

| Metric | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Full answer accuracy | 50.0% (15/30) | 60.0% (18/30) | +10.0%p |
| VECTOR answer accuracy | 50.0% (5/10) | 80.0% (8/10) | +30.0%p |
| SQL answer accuracy | 50.0% (5/10) | 50.0% (5/10) | 0.0%p |
| GRAPH answer accuracy | 50.0% (5/10) | 50.0% (5/10) | 0.0%p |
| Mean latency | 5,503 ms | 8,393 ms | +2,890 ms |

Decision: keep the PR open because full accuracy improves by 10 percentage points
with zero request errors. The additional validator call adds substantial latency, so
production adoption should gate the hook to uncertain drafts or use a smaller verifier.

Raw evidence: `eval/results/full-keyword-gap-claude-stop-hook-gemma4b-spring.json`.
