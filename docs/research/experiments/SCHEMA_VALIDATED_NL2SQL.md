# Schema-validated NL2SQL

## Hypothesis

Rejecting table and qualified-column references that do not exist in the live MCP
schema, then regenerating SQL with structured feedback, should reduce hallucinated
SQL. This adapts constrained decoding and self-correction ideas to an API model.

Primary sources:

- PICARD (EMNLP 2021): <https://aclanthology.org/2021.emnlp-main.779/>
- DIN-SQL (NeurIPS 2023): <https://papers.neurips.cc/paper_files/paper/2023/hash/72223cc66f63ca1aa59edaec1b3670e6-Abstract-Conference.html>

## Change

- Fetch the MCP schema once per SQL route.
- Ground prompt instructions in actual tables, columns, values, and date semantics.
- Validate every `FROM`/`JOIN` table and `alias.column` reference before execution.
- Regenerate once with a precise schema error; retain the existing execution retry.

## Result and decision

| Metric | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Full answer accuracy | 50.0% (15/30) | 50.0% (15/30) | 0.0%p |
| SQL answer accuracy | 50.0% (5/10) | 50.0% (5/10) | 0.0%p |
| Routing accuracy | 93.3% (28/30) | 93.3% (28/30) | 0.0%p |
| Mean latency | 5,503 ms | 5,705 ms | +202 ms |

The validator improves fail-closed behavior for nonexistent identifiers, but the
remaining benchmark errors use valid yet semantically wrong columns or aggregations.
Because the target metric did not improve, the candidate is closed without merge.

Raw result: `eval/results/full-keyword-gap-schema-validated-gemma4b-spring.json`.
