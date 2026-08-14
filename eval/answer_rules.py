#!/usr/bin/env python3
"""Shared answer grading rules for benchmark datasets and rescoring."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AnswerRule:
    any_of: tuple[str, ...]
    all_of: tuple[str, ...]
    any_of_groups: tuple[tuple[str, ...], ...]
    min_matches: int


def _contains(answer: str, phrase: str) -> bool:
    return phrase.casefold() in answer.casefold()


def rule_for_question(question: dict[str, Any]) -> AnswerRule:
    raw_rule = question.get("answerRule") or {}
    any_of = tuple(str(value) for value in raw_rule.get("anyOf", question.get("keywords", [])))
    all_of = tuple(str(value) for value in raw_rule.get("allOf", []))
    any_of_groups = tuple(
        tuple(str(value) for value in group)
        for group in raw_rule.get("anyOfGroups", [])
    )
    default_min = 1 if any_of else 0
    min_matches = int(raw_rule.get("minMatches", default_min))
    if min_matches < 0:
        raise ValueError("answerRule.minMatches must be non-negative")
    if any_of and min_matches > len(any_of):
        raise ValueError("answerRule.minMatches cannot exceed answerRule.anyOf length")
    if not any_of and min_matches > 0:
        raise ValueError("answerRule.minMatches requires answerRule.anyOf")
    if any(not group for group in any_of_groups):
        raise ValueError("answerRule.anyOfGroups cannot contain an empty group")
    return AnswerRule(
        any_of=any_of,
        all_of=all_of,
        any_of_groups=any_of_groups,
        min_matches=min_matches,
    )


def grade_answer(answer: str, question: dict[str, Any]) -> dict[str, Any]:
    rule = rule_for_question(question)
    matched_any = [phrase for phrase in rule.any_of if _contains(answer, phrase)]
    matched_all = [phrase for phrase in rule.all_of if _contains(answer, phrase)]
    matched_groups = [
        [phrase for phrase in group if _contains(answer, phrase)]
        for group in rule.any_of_groups
    ]
    answer_correct = (
        len(matched_any) >= rule.min_matches
        and len(matched_all) == len(rule.all_of)
        and all(matched for matched in matched_groups)
    )
    return {
        "answerCorrect": answer_correct,
        "matchedKeywords": matched_any,
        "matchedAllOf": matched_all,
        "matchedAnyOfGroups": matched_groups,
        "answerRule": {
            "anyOf": list(rule.any_of),
            "allOf": list(rule.all_of),
            "anyOfGroups": [list(group) for group in rule.any_of_groups],
            "minMatches": rule.min_matches,
        },
    }
