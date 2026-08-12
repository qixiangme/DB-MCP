#!/usr/bin/env python3
"""Re-score saved benchmark results with the shared answer rules."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from answer_rules import grade_answer


LATIN1 = "latin-1"


def repair_mojibake(text: str) -> str:
    try:
        repaired = text.encode(LATIN1).decode("utf-8")
        return text if "\ufffd" in repaired else repaired
    except UnicodeError:
        return text


def load_questions(dataset_path: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads(dataset_path.read_text(encoding="utf-8"))
    questions = payload["questions"] if isinstance(payload, dict) else payload
    return {str(question["id"]): question for question in questions}


def build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    answer_correct = sum(bool(row["answerCorrect"]) for row in rows)
    route_correct = sum(bool(row["routeCorrect"]) for row in rows)
    valid_latencies = [int(row["latencyMs"]) for row in rows if row.get("error") is None and row.get("latencyMs") is not None]
    by_route = {}
    for route in ("SQL", "VECTOR", "GRAPH"):
        selected = [row for row in rows if row["expectedRoute"] == route]
        by_route[route] = {
            "answerAccuracyPct": round(100 * sum(bool(row["answerCorrect"]) for row in selected) / len(selected), 1) if selected else None,
            "routeAccuracyPct": round(100 * sum(bool(row["routeCorrect"]) for row in selected) / len(selected), 1) if selected else None,
            "count": len(selected),
        }
    outcomes = Counter(
        "request-error" if row.get("error") else
        "route-and-answer" if not row["routeCorrect"] and not row["answerCorrect"] else
        "route-only" if not row["routeCorrect"] else
        "answer-only" if not row["answerCorrect"] else "pass"
        for row in rows
    )
    return {
        "answerAccuracyPct": round(100 * answer_correct / total, 1) if total else None,
        "routeAccuracyPct": round(100 * route_correct / total, 1) if total else None,
        "answerCorrect": answer_correct,
        "routeCorrect": route_correct,
        "total": total,
        "errors": sum(row.get("error") is not None for row in rows),
        "averageLatencyMs": round(sum(valid_latencies) / len(valid_latencies)) if valid_latencies else None,
        "byExpectedRoute": by_route,
        "outcomes": dict(sorted(outcomes.items())),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in-file", required=True)
    parser.add_argument("--out-file", required=True)
    parser.add_argument("--dataset")
    args = parser.parse_args()

    input_path = Path(args.in_file)
    report = json.loads(input_path.read_text(encoding="utf-8"))
    metadata = report.get("metadata", {})
    rows = report["rows"] if isinstance(report, dict) else report
    dataset_value = args.dataset or metadata.get("dataset")
    if not dataset_value:
        raise SystemExit("dataset path is required via --dataset or report metadata.dataset")

    dataset_path = Path(dataset_value)
    if not dataset_path.is_absolute():
        dataset_path = (input_path.parents[2] / dataset_path).resolve()
    questions = load_questions(dataset_path)

    rescored_rows = []
    for row in rows:
        rescored = dict(row)
        rescored["answer"] = repair_mojibake(str(rescored.get("answer", "")))
        grading = grade_answer(rescored["answer"], questions[str(rescored["id"])])
        rescored.update(grading)
        rescored_rows.append(rescored)

    summary = build_summary(rescored_rows)
    output = {
        "metadata": {
            **metadata,
            "dataset": str(dataset_path),
            "rescoredAt": datetime.now(timezone.utc).isoformat(),
            "rescoredFrom": str(input_path),
        },
        "summary": summary,
        "rows": rescored_rows,
    }

    output_path = Path(args.out_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"saved: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
