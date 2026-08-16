from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ISSUE_TEMPLATES = (
    "feature.yml",
    "bug.yml",
    "benchmark.yml",
    "docs.yml",
    "refactor.yml",
    "security.yml",
)
PR_TEMPLATES = (
    "feature.md",
    "bug.md",
    "benchmark.md",
    "docs.md",
    "refactor.md",
    "security.md",
)


class TemplateContractTest(unittest.TestCase):
    def test_issue_templates_require_traceable_evaluation_evidence(self) -> None:
        required_ids = (
            "secondary_evaluation_category",
            "baseline_branch",
            "current_evidence",
            "before_after_validation",
            "risks_and_rollback",
        )
        for name in ISSUE_TEMPLATES:
            contents = (ROOT / ".github" / "ISSUE_TEMPLATE" / name).read_text(encoding="utf-8")
            for field_id in required_ids:
                self.assertIn(f"id: {field_id}", contents, name)

    def test_pr_templates_require_branch_evidence_and_rollback(self) -> None:
        required_headings = ("### 기준 브랜치", "### 현재 문제 증거", "### 위험과 되돌리기")
        for name in PR_TEMPLATES:
            contents = (ROOT / ".github" / "PULL_REQUEST_TEMPLATE" / name).read_text(encoding="utf-8")
            for heading in required_headings:
                self.assertIn(heading, contents, name)

    def test_contribution_documents_describe_the_same_contract(self) -> None:
        for relative_path in ("README.md", "CONTRIBUTING.md", "docs/contributing/WORKFLOW.md"):
            contents = (ROOT / relative_path).read_text(encoding="utf-8")
            for phrase in ("보조 평가항목", "기준 브랜치", "위험과 되돌리기"):
                self.assertIn(phrase, contents, relative_path)


if __name__ == "__main__":
    unittest.main()
