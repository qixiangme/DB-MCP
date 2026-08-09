#!/usr/bin/env python3
"""DB/MCP 없이 Ollama 라우팅 프롬프트만 재현 평가한다."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROUTES = ("SQL", "VECTOR", "GRAPH")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", default="eval/keyword-gap-eval.json", dest="set_file")
    parser.add_argument("--prompt", default="eval/router-prompts/current-ai.txt")
    parser.add_argument("--model", default="gemma3:1b")
    parser.add_argument("--base-url", default="http://localhost:11434")
    parser.add_argument("--reps", type=int, default=1)
    parser.add_argument("--output", default="eval/results/router-eval.json")
    parser.add_argument("--fail-under", type=float, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def git_value(*args: str) -> str:
    try:
        return subprocess.check_output(["git", *args], text=True).strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def exact_route(raw: str) -> str | None:
    normalized = raw.strip().upper()
    return normalized if normalized in ROUTES else None


def classify(base_url: str, model: str, prompt: str) -> tuple[str, int]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/generate",
        data=json.dumps(
            {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "keep_alive": "15m",
                "options": {"temperature": 0, "num_predict": 8},
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.load(response)
    return str(payload.get("response", "")), round((time.perf_counter() - started) * 1000)


def main() -> int:
    args = parse_args()
    if args.reps < 1:
        raise SystemExit("--reps must be at least 1")

    dataset_path = Path(args.set_file)
    prompt_path = Path(args.prompt)
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    template = prompt_path.read_text(encoding="utf-8")
    if "{{question}}" not in template:
        raise SystemExit("prompt template must include {{question}}")

    rows: list[dict[str, object]] = []
    for rep in range(1, args.reps + 1):
        for item in dataset["questions"]:
            rendered = template.replace("{{question}}", item["question"])
            raw = "DRY_RUN"
            latency_ms = 0
            error = None
            if not args.dry_run:
                try:
                    raw, latency_ms = classify(args.base_url, args.model, rendered)
                except (TimeoutError, urllib.error.URLError, json.JSONDecodeError) as exc:
                    error = f"{type(exc).__name__}: {exc}"
                    raw = ""
            actual = exact_route(raw)
            correct = actual == item["expectedRoute"]
            row = {
                "rep": rep,
                "id": item["id"],
                "question": item["question"],
                "expectedRoute": item["expectedRoute"],
                "actualRoute": actual or "INVALID",
                "correct": correct,
                "latencyMs": latency_ms,
                "raw": raw.strip()[:200],
                "error": error,
            }
            rows.append(row)
            mark = "O" if correct else "X"
            print(f"[{item['id']} rep{rep}] {mark} expected={item['expectedRoute']} actual={row['actualRoute']} {latency_ms}ms")

    total = len(rows)
    correct_count = sum(bool(row["correct"]) for row in rows)
    accuracy = round(100 * correct_count / total, 1) if total else 0.0
    valid_latencies = [int(row["latencyMs"]) for row in rows if not row["error"]]
    confusion = Counter((str(row["expectedRoute"]), str(row["actualRoute"])) for row in rows)
    summary = {
        "accuracyPct": accuracy,
        "correct": correct_count,
        "total": total,
        "invalid": sum(row["actualRoute"] == "INVALID" for row in rows),
        "errors": sum(row["error"] is not None for row in rows),
        "averageLatencyMs": round(sum(valid_latencies) / len(valid_latencies)) if valid_latencies else None,
        "confusion": {f"{expected}->{actual}": count for (expected, actual), count in sorted(confusion.items())},
    }
    report = {
        "metadata": {
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "commit": git_value("rev-parse", "HEAD"),
            "branch": git_value("branch", "--show-current"),
            "dirty": bool(git_value("status", "--porcelain")),
            "dataset": str(dataset_path),
            "prompt": str(prompt_path),
            "model": args.model,
            "reps": args.reps,
            "temperature": 0,
        },
        "summary": summary,
        "rows": rows,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"saved: {output_path}")

    if args.fail_under is not None and accuracy < args.fail_under:
        print(f"FAIL: {accuracy}% < {args.fail_under}%", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
