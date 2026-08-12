from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path

from answer_rules import rule_for_question


class CompositionalDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        path = Path(__file__).with_name("compositional-eval-v1.json")
        cls.data = json.loads(path.read_text(encoding="utf-8"))
        cls.questions = cls.data["questions"]

    def test_has_30_unique_questions_and_fixed_split(self) -> None:
        self.assertEqual(len(self.questions), 30)
        self.assertEqual(len({item["id"] for item in self.questions}), 30)
        self.assertEqual(Counter(item["split"] for item in self.questions), {"dev": 20, "holdout": 10})

    def test_each_category_has_five_questions(self) -> None:
        self.assertEqual(
            set(Counter(item["type"] for item in self.questions).values()),
            {5},
        )

    def test_every_question_is_multi_route_and_has_strict_rule(self) -> None:
        for item in self.questions:
            self.assertGreaterEqual(len(item["expectedRoutes"]), 2, item["id"])
            rule = rule_for_question(item)
            self.assertTrue(rule.all_of or rule.any_of_groups, item["id"])


if __name__ == "__main__":
    unittest.main()
