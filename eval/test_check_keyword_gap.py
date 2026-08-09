import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("check-keyword-gap.py")
SPEC = importlib.util.spec_from_file_location("check_keyword_gap", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ExtractKeywordsTest(unittest.TestCase):
    def test_extracts_all_expected_blocks(self) -> None:
        source = """
    private val sqlKeywords = listOf(
        "count"
    )
    private val graphKeywords = listOf(
        "related"
    )
    private val vectorKeywords = listOf(
        "explain"
    )
"""

        self.assertEqual(["related", "count", "explain"], MODULE.extract_keywords(source))

    def test_rejects_missing_block(self) -> None:
        source = """
    private val sqlKeywords = listOf(
        "count"
    )
"""

        with self.assertRaisesRegex(ValueError, "graphKeywords, vectorKeywords"):
            MODULE.extract_keywords(source)


if __name__ == "__main__":
    unittest.main()
