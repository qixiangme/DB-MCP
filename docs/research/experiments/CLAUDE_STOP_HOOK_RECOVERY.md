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

Result pending. The branch is accepted only if the Docker full-stack keyword-gap
answer accuracy improves; otherwise its issue and PR are closed without merge.
