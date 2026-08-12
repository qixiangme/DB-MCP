#!/usr/bin/env python3
"""Evidence-bounded automatic claim checks for benchmark reports.

숫자와 명시적 Company-X 식별자만 자동 판정한다. 자연어 인과·관계는 자동 점수로
위장하지 않고 humanReviewRequired로 남긴다.
"""

from __future__ import annotations

import re
from typing import Any


IDENTIFIER = re.compile(
    r"(?<![A-Za-z0-9_-])(?:Product|Client|DOC|TICKET|PRJ|EMP)-[A-Za-z0-9_-]+(?![A-Za-z0-9_-])",
    re.IGNORECASE,
)
NUMBER = re.compile(r"(?<![A-Za-z0-9_-])\d[\d,]*(?:\.\d+)?%?(?![A-Za-z0-9_-])")


def _normalize(value: str) -> str:
    return value.casefold().replace(",", "")


def extract_verifiable_tokens(text: str) -> list[str]:
    values = [match.group(0) for match in IDENTIFIER.finditer(text)]
    values.extend(match.group(0) for match in NUMBER.finditer(text))
    return list(dict.fromkeys(values))


def evaluate_claim_support(
    answer: str,
    question: str,
    selected_evidence: object,
) -> dict[str, Any]:
    if not isinstance(selected_evidence, list):
        return {
            "status": "UNASSESSED",
            "supported": [],
            "unsupported": [],
            "humanReviewRequired": True,
        }

    evidence_text = "\n".join(
        f"{item.get('source', '')}\n{item.get('text', '')}"
        for item in selected_evidence
        if isinstance(item, dict)
    )
    evidence_tokens = {_normalize(token) for token in extract_verifiable_tokens(evidence_text)}
    question_tokens = {_normalize(token) for token in extract_verifiable_tokens(question)}
    answer_tokens = extract_verifiable_tokens(answer)

    # 질문에 이미 들어 있던 식별자·숫자를 반복한 것은 새로운 사실 claim으로 세지 않는다.
    assessable = [token for token in answer_tokens if _normalize(token) not in question_tokens]
    supported = [token for token in assessable if _normalize(token) in evidence_tokens]
    unsupported = [token for token in assessable if _normalize(token) not in evidence_tokens]
    return {
        "status": "UNSUPPORTED" if unsupported else "SUPPORTED",
        "supported": supported,
        "unsupported": unsupported,
        "humanReviewRequired": True,
    }
