#!/usr/bin/env python3
"""Shared helpers for structured evaluation reports."""

from __future__ import annotations

from collections import Counter
from math import ceil
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


def percentile(values: list[int], fraction: float) -> int | None:
    """Nearest-rank percentile. Small benchmark에서도 정의가 흔들리지 않게 한 방식을 고정한다."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, ceil(fraction * len(ordered)))
    return ordered[rank - 1]


def numeric_summary(values: list[int]) -> dict[str, int | None]:
    return {
        "mean": round(sum(values) / len(values)) if values else None,
        "p50": percentile(values, 0.50),
        "p95": percentile(values, 0.95),
    }


def summarize_rows(rows: Iterable[dict[str, object]]) -> dict[str, object]:
    row_list = list(rows)
    total = len(row_list)
    answer_correct = sum(bool(row.get("answerCorrect")) for row in row_list)
    route_correct = sum(bool(row.get("routeCorrect")) for row in row_list)
    valid_latencies = [int(row["latencyMs"]) for row in row_list if row.get("error") is None]
    wall_latencies = [int(row["wallMs"]) for row in row_list if row.get("error") is None and row.get("wallMs") is not None]
    context_chars = [int(row.get("contextChars", 0)) for row in row_list if row.get("error") is None]
    context_tokens = [int(row.get("estimatedContextTokens", 0)) for row in row_list if row.get("error") is None]
    assessed_claims = [row.get("claimSupport") for row in row_list if isinstance(row.get("claimSupport"), dict)]
    supported_claims = sum(len(claim.get("supported", [])) for claim in assessed_claims)
    unsupported_claims = sum(len(claim.get("unsupported", [])) for claim in assessed_claims)
    by_route: dict[str, dict[str, object]] = {}
    for route in ROUTES:
        selected = [row for row in row_list if route in (row.get("expectedRoutes") or [row.get("expectedRoute")])]
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
        "latencyMs": numeric_summary(valid_latencies),
        "wallMs": numeric_summary(wall_latencies),
        "contextChars": numeric_summary(context_chars),
        "estimatedContextTokens": numeric_summary(context_tokens),
        "responseModes": dict(sorted(Counter(str(row.get("responseMode", "UNKNOWN")) for row in row_list).items())),
        "failedRoutes": dict(sorted(Counter(
            str(route) for row in row_list for route in (row.get("failedRoutes") or [])
        ).items())),
        "claimSupport": {
            "supported": supported_claims,
            "unsupported": unsupported_claims,
            "unsupportedRatePct": round(
                100 * unsupported_claims / (supported_claims + unsupported_claims), 1
            ) if supported_claims + unsupported_claims else None,
            "scope": "numbers-and-explicit-identifiers-only",
        },
        "byExpectedRoute": by_route,
        "outcomes": dict(sorted(outcomes.items())),
    }


def build_report(metadata: dict[str, object], rows: list[dict[str, object]]) -> dict[str, object]:
    return {
        "metadata": metadata,
        "summary": summarize_rows(rows),
        "rows": rows,
    }
