#!/usr/bin/env python3
"""Normalize legacy flat evaluation rows into the structured report schema."""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from result_report import build_report, normalize_routes, repair_mojibake


def git_value(*args: str) -> str:
    try:
        return subprocess.check_output(["git", *args], text=True, timeout=5).strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def load_questions(path: Path) -> dict[str, dict[str, object]]:
    return {item["id"]: item for item in json.loads(path.read_text(encoding="utf-8"))["questions"]}


def normalize_rows(raw_rows: list[dict[str, object]], questions: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for row in raw_rows:
        item = questions[str(row["id"])]
        answer = repair_mojibake(str(row.get("answer", "")))
        keywords = [str(keyword) for keyword in item.get("keywords", [])]
        matched = [keyword for keyword in keywords if keyword.casefold() in answer.casefold()]
        routes = normalize_routes(row.get("actualRoutes"))
        normalized.append(
            {
                "rep": int(row.get("rep", 1)),
                "id": item["id"],
                "question": item["question"],
                "expectedRoute": item["expectedRoute"],
                "actualRoutes": routes,
                "routeCorrect": item["expectedRoute"] in routes,
                "answerCorrect": bool(matched),
                "matchedKeywords": matched,
                "latencyMs": int(row.get("latencyMs", -1)),
                "wallMs": int(row.get("wallMs", row.get("latencyMs", -1))),
                "toolCalls": row.get("toolCalls", []),
                "contextSources": row.get("contextSources", []),
                "answer": answer,
                "error": row.get("error"),
            }
        )
    return normalized


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in-file", required=True)
    parser.add_argument("--out-file", required=True)
    parser.add_argument("--dataset", default="eval/eval-set.json")
    parser.add_argument("--label", default="legacy-normalized")
    args = parser.parse_args()

    in_file = Path(args.in_file)
    payload = json.loads(in_file.read_text(encoding="utf-8-sig"))
    raw_rows = payload["rows"] if isinstance(payload, dict) and "rows" in payload else payload
    questions = load_questions(Path(args.dataset))
    rows = normalize_rows(raw_rows, questions)
    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "commit": git_value("rev-parse", "HEAD"),
        "branch": git_value("branch", "--show-current"),
        "dirty": bool(git_value("status", "--porcelain", "--untracked-files=no")),
        "dataset": args.dataset,
        "sourceFile": args.in_file,
        "sourceFormat": "structured" if isinstance(payload, dict) and "rows" in payload else "legacy-flat-rows",
        "label": args.label,
    }
    if isinstance(payload, dict) and "metadata" in payload:
        metadata["sourceMetadata"] = payload["metadata"]

    report = build_report(metadata, rows)
    out_file = Path(args.out_file)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"saved: {out_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
