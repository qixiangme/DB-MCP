package router

import (
	"regexp"
	"strings"
)

// entityAnchorRe mirrors ENTITY_ANCHOR in RouteQuestionProjector.kt.
var entityAnchorRe = regexp.MustCompile(`(?i)(?:Product|Client)-[A-Z0-9]+|[\x{AC00}-\x{D7A3}A-Za-z0-9]+(?:팀|부|부서)`)
var projectorCategoryRe = regexp.MustCompile(`(?i)(?:cloud|data|security|consulting)`)

var projectorCues = map[Route][]string{
	RouteSQL: {
		"가격", "금액", "매출", "급여", "연봉", "평균", "합계", "총 ", "건", "개수",
		"계약", "출시 상태", "상태", "순위", "상위", "하위", "재고", "직원", "월 ",
		"price", "amount", "sales", "salary", "average", "sum", "count", "status",
	},
	RouteVector: {
		"설치", "배포", "백업", "보관", "구동", "인증", "bearer", "api", "cpu", "hpa", "제안",
		"문서", "매뉴얼", "장애", "원인", "조치", "절차", "방법", "도구", "대상 고객",
		"install", "deploy", "backup", "guide", "manual", "incident",
	},
	RouteGraph: {
		"사용 고객", "이용 고객", "사용하는 고객", "쓰는 고객", "사용하는", "이용하는", "쓰는", "실제 사용", "실제 이용",
		"현재 사용", "현재 이용", "담당 직원", "담당자", "팀장", "이끄는 사람", "누구",
		"관계", "소속", "개발사", "라이선스", "using client", "owner", "relation",
	},
}

// RouteQuestionProjector ports RouteQuestionProjector.kt 1:1: projects a compound
// question onto a route-narrowed sub-question using boundary splitting + cue words.
type RouteQuestionProjector struct{}

func (p *RouteQuestionProjector) Project(question string, route Route) string {
	fragments := splitBoundary(question)
	if len(fragments) < 2 {
		return question
	}

	cues := projectorCues[route]
	var selected []string
	for _, fragment := range fragments {
		lower := strings.ToLower(fragment)
		for _, cue := range cues {
			if strings.Contains(lower, cue) {
				selected = append(selected, fragment)
				break
			}
		}
	}
	if len(selected) == 0 || len(selected) == len(fragments) {
		return question
	}

	projected := strings.Join(selected, " 그리고 ")

	var entityAnchors []string
	for _, m := range entityAnchorRe.FindAllString(question, -1) {
		if route != RouteVector || strings.HasPrefix(strings.ToLower(m), "product-") {
			entityAnchors = append(entityAnchors, m)
		}
	}
	var categoryAnchors []string
	if route == RouteSQL {
		categoryAnchors = projectorCategoryRe.FindAllString(question, -1)
	}

	anchors := dedupStrings(append(entityAnchors, categoryAnchors...))
	var missingAnchors []string
	for _, a := range anchors {
		if !strings.Contains(strings.ToLower(projected), strings.ToLower(a)) {
			missingAnchors = append(missingAnchors, a)
		}
	}

	result := strings.TrimSpace(strings.Join(append(missingAnchors, projected), " "))
	result = strings.TrimRight(result, ".?!")
	result = strings.TrimSuffix(result, "알려줘")
	result = strings.TrimSuffix(result, "설명해줘")
	result = strings.TrimSuffix(result, "확인해줘")
	result = strings.TrimSuffix(result, "정리해줘")
	result = strings.TrimSpace(result)
	return result + " 알려줘"
}

func dedupStrings(items []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, it := range items {
		if !seen[it] {
			seen[it] = true
			out = append(out, it)
		}
	}
	return out
}

// boundaryPattern mirrors BOUNDARY in RouteQuestionProjector.kt, minus the
// `(?<=[가-힣A-Za-z0-9])` lookbehind on the trailing `(과|와)\s+` alternative, which
// Go's RE2 cannot express. splitBoundary re-implements that lookbehind by checking the
// character preceding each `과 `/`와 ` match before treating it as a boundary.
var boundaryPattern = regexp.MustCompile(
	`\s*(?:,(?:\s)|그리고|함께|같이|동시에|구분하고|나눠\s*말하고|한\s*번에|(?:하며|이며|하고|쓰고|늘어나며)\s+|\s및\s|과\s+|와\s+)\s*`,
)

var wordCharRe = regexp.MustCompile(`[\x{AC00}-\x{D7A3}A-Za-z0-9]`)

// splitBoundary mirrors question.split(BOUNDARY), applying the `(과|와)` lookbehind guard.
func splitBoundary(question string) []string {
	matches := boundaryPattern.FindAllStringIndex(question, -1)
	var fragments []string
	last := 0
	for _, m := range matches {
		start, end := m[0], m[1]
		matched := question[start:end]
		trimmedMatched := strings.TrimSpace(matched)
		if trimmedMatched == "과" || trimmedMatched == "와" {
			if start == 0 || !wordCharRe.MatchString(string(lastRune(question[:start]))) {
				continue // lookbehind failed: not a real boundary, keep scanning
			}
		}
		fragments = append(fragments, strings.TrimSpace(question[last:start]))
		last = end
	}
	fragments = append(fragments, strings.TrimSpace(question[last:]))

	out := make([]string, 0, len(fragments))
	for _, f := range fragments {
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

func lastRune(s string) rune {
	r := []rune(s)
	if len(r) == 0 {
		return 0
	}
	return r[len(r)-1]
}
