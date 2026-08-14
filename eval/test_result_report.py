from __future__ import annotations

import unittest

from normalize_legacy_results import normalize_rows
from result_report import build_report, percentile, repair_mojibake


class ResultReportTest(unittest.TestCase):
    def test_repair_mojibake_recovers_korean_text(self) -> None:
        broken = "MCPê° ë­ì¼?"
        self.assertEqual(repair_mojibake(broken), "MCP가 뭐야?")

    def test_normalize_rows_recomputes_schema_fields(self) -> None:
        questions = {
            "V1": {
                "id": "V1",
                "question": "MCP가 뭐야?",
                "expectedRoute": "VECTOR",
                "keywords": ["Anthropic"],
            }
        }
        rows = normalize_rows(
            [
                {
                    "rep": 1,
                    "id": "V1",
                    "actualRoutes": "VECTOR",
                    "latencyMs": 100,
                    "answer": "MCP는 Anthropic이 개발한 프로토콜입니다.",
                }
            ],
            questions,
        )
        self.assertEqual(rows[0]["actualRoutes"], ["VECTOR"])
        self.assertTrue(rows[0]["routeCorrect"])
        self.assertTrue(rows[0]["answerCorrect"])
        self.assertEqual(rows[0]["matchedKeywords"], ["Anthropic"])
        self.assertEqual(rows[0]["answer"], "MCP는 Anthropic이 개발한 프로토콜입니다.")

    def test_build_report_counts_outcomes(self) -> None:
        rows = [
            {"expectedRoute": "VECTOR", "routeCorrect": True, "answerCorrect": True, "latencyMs": 10, "error": None},
            {"expectedRoute": "SQL", "routeCorrect": False, "answerCorrect": False, "latencyMs": 20, "error": None},
            {"expectedRoute": "GRAPH", "routeCorrect": True, "answerCorrect": False, "latencyMs": 30, "error": None},
        ]
        report = build_report({"dataset": "eval/eval-set.json"}, rows)
        self.assertEqual(report["summary"]["total"], 3)
        self.assertEqual(report["summary"]["outcomes"]["pass"], 1)
        self.assertEqual(report["summary"]["outcomes"]["route-and-answer"], 1)
        self.assertEqual(report["summary"]["outcomes"]["answer-only"], 1)

    def test_percentiles_use_documented_nearest_rank(self) -> None:
        values = [10, 20, 30, 40, 100]
        self.assertEqual(percentile(values, 0.50), 30)
        self.assertEqual(percentile(values, 0.95), 100)

    def test_report_separates_exact_route_match_from_expected_route_recall(self) -> None:
        report = build_report(
            {},
            [{
                "expectedRoutes": ["GRAPH"],
                "routeCorrect": False,
                "routeRecallCorrect": True,
                "answerCorrect": True,
                "latencyMs": 10,
                "error": None,
            }],
        )
        summary = report["summary"]
        self.assertEqual(summary["routeAccuracyPct"], 0.0)
        self.assertEqual(summary["routeRecallAccuracyPct"], 100.0)
        self.assertEqual(summary["byExpectedRoute"]["GRAPH"]["routeRecallAccuracyPct"], 100.0)

    def test_report_includes_latency_context_and_degraded_modes(self) -> None:
        report = build_report(
            {},
            [{
                "expectedRoute": "SQL", "routeCorrect": True, "answerCorrect": True,
                "latencyMs": 25, "wallMs": 30, "contextChars": 400,
                "estimatedContextTokens": 100, "responseMode": "DEGRADED",
                "failedRoutes": ["VECTOR"], "error": None,
            }],
        )
        summary = report["summary"]
        self.assertEqual(summary["latencyMs"]["p95"], 25)
        self.assertEqual(summary["contextChars"]["mean"], 400)
        self.assertEqual(summary["responseModes"], {"DEGRADED": 1})
        self.assertEqual(summary["failedRoutes"], {"VECTOR": 1})


if __name__ == "__main__":
    unittest.main()
