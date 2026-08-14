#!/usr/bin/env python3
"""Validate comparable benchmark metadata and render the final one-page table."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def metric(report: dict[str, object], *path: str) -> object:
    value: object = report
    for key in path:
        value = value[key]  # type: ignore[index]
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("reports", nargs="+", help="LABEL=path.json")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    loaded: list[tuple[str, dict[str, object]]] = []
    for spec in args.reports:
        label, separator, filename = spec.partition("=")
        if not separator:
            raise SystemExit(f"expected LABEL=path, got {spec}")
        loaded.append((label, json.loads(Path(filename).read_text(encoding="utf-8"))))

    reference = loaded[0][1]["metadata"]
    comparable_keys = ("commit", "dataset", "datasetSha256", "reps", "model", "split")
    for label, report in loaded[1:]:
        metadata = report["metadata"]
        mismatches = {
            key: (reference.get(key), metadata.get(key))  # type: ignore[union-attr]
            for key in comparable_keys
            if reference.get(key) != metadata.get(key)  # type: ignore[union-attr]
        }
        if mismatches:
            raise SystemExit(f"{label} is not comparable: {mismatches}")

    headers = ["Metric", *[label for label, _ in loaded]]
    rows = [
        ["Routing accuracy", *[f"{metric(r, 'summary', 'routeAccuracyPct')}%" for _, r in loaded]],
        ["Overall accuracy", *[f"{metric(r, 'summary', 'answerAccuracyPct')}%" for _, r in loaded]],
        ["Context tokens mean", *[str(metric(r, 'summary', 'estimatedContextTokens', 'mean')) for _, r in loaded]],
        ["Latency p50 ms", *[str(metric(r, 'summary', 'latencyMs', 'p50')) for _, r in loaded]],
        ["Latency p95 ms", *[str(metric(r, 'summary', 'latencyMs', 'p95')) for _, r in loaded]],
        ["Unsupported claim tokens", *[str(metric(r, 'summary', 'claimSupport', 'unsupported')) for _, r in loaded]],
        ["Request errors", *[str(metric(r, 'summary', 'errors')) for _, r in loaded]],
    ]
    markdown = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] + ["---:" for _ in loaded]) + "|",
        *["| " + " | ".join(row) + " |" for row in rows],
        "",
        f"Commit: `{reference['commit']}` · dataset: `{reference['dataset']}` · reps: {reference['reps']} · model: `{reference['model']}`",
        "",
        "> Unsupported claim은 숫자와 명시적 식별자만 자동 판정하며 자연어 관계·인과는 수동 검토 대상이다.",
    ]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(markdown) + "\n", encoding="utf-8")
    print("\n".join(markdown))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
