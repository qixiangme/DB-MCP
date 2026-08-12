#!/usr/bin/env python3
"""Shared helpers for structured evaluation reports."""

from __future__ import annotations

from collections import Counter
from typing import Iterable


ROUTES = ("SQL", "VECTOR", "GRAPH")


def repair_mojibake(text: str) -> str:
    """Recover UTF-8 text that was decoded as Latin-1."""
    current = text
    for _ in range(2):
        try:
            fixed = current.encode("latin-1").decode("utf-8")
        except UnicodeError:
            return current
        if fixed == current or "\ufffd" in fixed:
            return current
        current = fixed
    return current


def normalize_routes(actual_routes: object) -> list[str]:
    if actual_routes is None:
        return []
    if isinstance(actual_routes, list):
        return [str(route) for route in actual_routes]
    if isinstance(actual_routes, str):
        return [actual_routes]
    return [str(actual_routes)]


def classify_outcome(row: dict[str, object]) -> str:
    if row.get("error"):
        return "request-error"
    if not row.get("routeCorrect") and not row.get("answerCorrect"):
        return "route-and-answer"
    if not row.get("routeCorrect"):
        return "route-only"
    if not row.get("answerCorrect"):
        return "answer-only"
    return "pass"


def summarize_rows(rows: Iterable[dict[str, object]]) -> dict[str, object]:
    row_list = list(rows)
    total = len(row_list)
    answer_correct = sum(bool(row.get("answerCorrect")) for row in row_list)
    route_correct = sum(bool(row.get("routeCorrect")) for row in row_list)
    valid_latencies = [int(row["latencyMs"]) for row in row_list if row.get("error") is None]
    by_route: dict[str, dict[str, object]] = {}
    for route in ROUTES:
        selected = [row for row in row_list if row.get("expectedRoute") == route]
        if selected:
            by_route[route] = {
                "answerAccuracyPct": round(100 * sum(bool(row.get("answerCorrect")) for row in selected) / len(selected), 1),
                "routeAccuracyPct": round(100 * sum(bool(row.get("routeCorrect")) for row in selected) / len(selected), 1),
                "count": len(selected),
            }
    outcomes = Counter(classify_outcome(row) for row in row_list)
    return {
        "answerAccuracyPct": round(100 * answer_correct / total, 1) if total else 0.0,
        "routeAccuracyPct": round(100 * route_correct / total, 1) if total else 0.0,
        "answerCorrect": answer_correct,
        "routeCorrect": route_correct,
        "total": total,
        "errors": sum(row.get("error") is not None for row in row_list),
        "averageLatencyMs": round(sum(valid_latencies) / len(valid_latencies)) if valid_latencies else None,
        "byExpectedRoute": by_route,
        "outcomes": dict(sorted(outcomes.items())),
    }


def build_report(metadata: dict[str, object], rows: list[dict[str, object]]) -> dict[str, object]:
    return {
        "metadata": metadata,
        "summary": summarize_rows(rows),
        "rows": rows,
    }
