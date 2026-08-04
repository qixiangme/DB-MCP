#!/usr/bin/env python3
"""평가 질문에 현재 RuleBasedRouter의 결정 키워드가 섞였는지 검사한다."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset")
    parser.add_argument("--router", default="agent-app/src/main/kotlin/com/riwonace/agent/router/RuleBasedRouter.kt")
    args = parser.parse_args()

    source = Path(args.router).read_text(encoding="utf-8")
    blocks = re.findall(r"private val \w+Keywords = listOf\((.*?)\n    \)", source, re.DOTALL)
    keywords = [value.lower() for block in blocks for value in re.findall(r'"([^"]+)"', block)]
    questions = json.loads(Path(args.dataset).read_text(encoding="utf-8"))["questions"]
    violations = []
    for item in questions:
        lowered = item["question"].lower()
        matched = [keyword for keyword in keywords if keyword in lowered]
        if matched:
            violations.append((item["id"], matched))

    if violations:
        for item_id, matched in violations:
            print(f"{item_id}: {', '.join(matched)}")
        return 1
    print(f"OK: {len(questions)} questions, {len(keywords)} router keywords, no overlap")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
