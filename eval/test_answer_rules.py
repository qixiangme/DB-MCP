#!/usr/bin/env python3
"""Unit tests for benchmark answer grading rules."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from answer_rules import grade_answer, rule_for_question
from rescore_results import build_summary


class AnswerRuleTest(unittest.TestCase):
    def test_defaults_to_keywords(self) -> None:
        result = grade_answer("Bearer 토큰을 사용합니다.", {"keywords": ["Bearer", "토큰"]})
        self.assertTrue(result["answerCorrect"])
        self.assertEqual(result["matchedKeywords"], ["Bearer", "토큰"])

    def test_min_matches_blocks_single_keyword_hit(self) -> None:
        question = {
            "keywords": ["Connection Pool", "인덱스", "캐싱", "Redis", "슬로우 쿼리"],
            "answerRule": {"minMatches": 2},
        }
        result = grade_answer("DB 쿼리 최적화와 캐싱 전략 재검토가 필요합니다.", question)
        self.assertFalse(result["answerCorrect"])
        self.assertEqual(result["matchedKeywords"], ["캐싱"])

    def test_all_of_requires_every_required_phrase(self) -> None:
        question = {
            "keywords": ["Bearer", "토큰"],
            "answerRule": {"allOf": ["Bearer", "토큰"], "minMatches": 0},
        }
        self.assertTrue(grade_answer("Bearer 토큰 방식입니다.", question)["answerCorrect"])
        self.assertFalse(grade_answer("Bearer 방식입니다.", question)["answerCorrect"])

    def test_invalid_min_matches_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            rule_for_question({"answerRule": {"anyOf": ["A"], "minMatches": 2}})

    def test_every_any_of_group_requires_one_match(self) -> None:
        question = {
            "answerRule": {
                "anyOfGroups": [["350", "삼백오십"], ["Docker", "Helm"]],
            }
        }
        self.assertTrue(grade_answer("월 350원이며 Docker로 설치합니다.", question)["answerCorrect"])
        self.assertFalse(grade_answer("월 350원입니다.", question)["answerCorrect"])

    def test_empty_any_of_group_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            rule_for_question({"answerRule": {"anyOfGroups": [[]]}})

    def test_summary_matches_expected_shape(self) -> None:
        rows = [
            {"expectedRoute": "SQL", "answerCorrect": True, "routeCorrect": True, "error": None, "latencyMs": 10},
            {"expectedRoute": "VECTOR", "answerCorrect": False, "routeCorrect": True, "error": None, "latencyMs": 20},
            {"expectedRoute": "GRAPH", "answerCorrect": False, "routeCorrect": False, "error": None, "latencyMs": 30},
        ]
        summary = build_summary(rows)
        self.assertEqual(summary["answerAccuracyPct"], 33.3)
        self.assertEqual(summary["routeAccuracyPct"], 66.7)
        self.assertEqual(summary["outcomes"]["answer-only"], 1)
        self.assertEqual(summary["outcomes"]["route-and-answer"], 1)


if __name__ == "__main__":
    unittest.main()
