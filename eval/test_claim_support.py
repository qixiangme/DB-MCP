from __future__ import annotations

import unittest

from claim_support import evaluate_claim_support, extract_verifiable_tokens


class ClaimSupportTest(unittest.TestCase):
    def test_extracts_identifiers_and_numbers(self) -> None:
        self.assertEqual(
            extract_verifiable_tokens("Client-Q 매출은 23,859이고 Product-C1과 관련된다."),
            ["Client-Q", "Product-C1", "23,859"],
        )

    def test_marks_answer_token_missing_from_evidence_as_unsupported(self) -> None:
        result = evaluate_claim_support(
            "담당자는 EMP-99이고 총 8명입니다.",
            "담당자와 인원은?",
            [{"text": "담당자는 EMP-01이고 총 8명이다."}],
        )
        self.assertEqual(result["supported"], ["8"])
        self.assertEqual(result["unsupported"], ["EMP-99"])

    def test_question_identifier_is_not_counted_as_new_claim(self) -> None:
        result = evaluate_claim_support("Product-C1 문서입니다.", "Product-C1은?", [])
        self.assertEqual(result["unsupported"], [])

    def test_missing_evidence_trace_is_unassessed(self) -> None:
        result = evaluate_claim_support("총 8명", "몇 명?", None)
        self.assertEqual(result["status"], "UNASSESSED")


if __name__ == "__main__":
    unittest.main()
