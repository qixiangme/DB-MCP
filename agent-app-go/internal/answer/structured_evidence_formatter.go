// Package answer ports com.riwonace.agent.answer from the Kotlin/Spring AI baseline.
package answer

import (
	"regexp"
	"strings"
)

var (
	// singleCountRe is anchored to mirror Kotlin's matchEntire (the whole trimmed
	// string must match, not just a substring).
	singleCountRe      = regexp.MustCompile(`(?i)^(?:count|count\(\*\))=([0-9]+)$`)
	explicitCountUnitRe = regexp.MustCompile(`몇\s*(명|개|건|곳)`)
)

// StructuredEvidenceFormatter ports StructuredEvidenceFormatter.kt 1:1.
type StructuredEvidenceFormatter struct{}

func (f *StructuredEvidenceFormatter) FormatSQL(question, evidence string) string {
	m := singleCountRe.FindStringSubmatch(strings.TrimSpace(evidence))
	if m == nil {
		return evidence
	}
	count := m[1]
	return "총 " + count + countUnit(question) + " 입니다."
}

func countUnit(question string) string {
	if m := explicitCountUnitRe.FindStringSubmatch(question); m != nil {
		return m[1]
	}
	switch {
	case strings.Contains(question, "건"):
		return "건"
	case strings.Contains(question, "직원"), strings.Contains(question, "사람"), strings.Contains(question, "인원"):
		return "명"
	case strings.Contains(question, "고객사"):
		return "곳"
	default:
		return "개"
	}
}
