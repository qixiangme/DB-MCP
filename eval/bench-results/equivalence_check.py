#!/usr/bin/env python3
"""Functional-equivalence check across baseline / Go / Ktor implementations.

Per the migration's stated equivalence standard (see conversation record):
- deterministic paths (routing, DeterministicSqlPlanner-covered SQL, SqlGuard, tool
  contract, schema caching) are already verified byte-for-byte via ported oracle
  tests (RuleBasedRouterTest, DeterministicSqlPlannerTest, SqlGuardTest,
  RetrievalToolsContractTest / ToolRegistrationContractTest, McpGatewayTest) --
  these ran as part of each port's `go test` / `gradlew test` and are not re-run here.
- LLM-touched paths (final answer generation, LLM NL2SQL fallback) are checked only
  for structural equivalence: same expectedRoute actually selected (visible in the
  `routes` field of the /api/chat/v2 response) and same tool-call shape, not
  byte-identical generated text.

This script hits a single already-running implementation's /api/chat/v2 with the
official 30-question eval set and records route selection + answer-rule grading
(reusing eval/answer_rules.py, no new grading logic). Run once per implementation
(they share ports), then compare the three output files.
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from answer_rules import grade_answer  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
EVAL_FILE = REPO_ROOT / "eval" / "official-eval.json"


def ask(base_url, question, timeout=120):
    req = urllib.request.Request(
        f"{base_url}/api/chat/v2",
        data=json.dumps({"question": question}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
        return body, time.monotonic() - started


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--impl", required=True)
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    out_path = Path(args.out) if args.out else Path(__file__).parent / f"{args.impl}-equivalence.json"

    questions = json.loads(EVAL_FILE.read_text())["questions"]
    results = []

    for q in questions:
        try:
            body, elapsed = ask(args.base_url, q["question"])
        except Exception as e:
            results.append({"id": q["id"], "error": str(e)})
            continue

        expected_route = q.get("expectedRoute")
        actual_routes = body.get("routes", [])
        route_match = expected_route in actual_routes if expected_route else None

        grading = grade_answer(body.get("answer", ""), q)

        results.append({
            "id": q["id"],
            "question": q["question"],
            "expectedRoute": expected_route,
            "actualRoutes": actual_routes,
            "routeMatch": route_match,
            "toolCalls": body.get("toolCalls", []),
            "claimCoverage": body.get("claimCoverage"),
            "answerCorrect": grading["answerCorrect"],
            "matchedKeywords": grading["matchedKeywords"],
            "latencySeconds": elapsed,
        })
        print(f"[{args.impl}] {q['id']}: route={'OK' if route_match else 'MISS'} answer={'OK' if grading['answerCorrect'] else 'MISS'}", file=sys.stderr)

    n = len(results)
    route_matches = sum(1 for r in results if r.get("routeMatch"))
    answer_correct = sum(1 for r in results if r.get("answerCorrect"))
    errors = sum(1 for r in results if "error" in r)

    summary = {
        "impl": args.impl,
        "n": n,
        "route_match_rate": route_matches / n if n else None,
        "answer_accuracy": answer_correct / n if n else None,
        "errors": errors,
        "results": results,
    }

    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"[{args.impl}] route_match={route_matches}/{n} answer_correct={answer_correct}/{n} errors={errors}", file=sys.stderr)
    print(f"[{args.impl}] written to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
