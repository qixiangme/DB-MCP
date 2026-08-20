package tools

import (
	"regexp"
	"strings"
)

// retrievalTermPattern mirrors retrievalTerms()'s regex: [가-힣a-z0-9][가-힣a-z0-9_-]{1,}
var retrievalTermPattern = regexp.MustCompile(`[\x{AC00}-\x{D7A3}a-z0-9][\x{AC00}-\x{D7A3}a-z0-9_-]+`)

// retrievalSuffixes mirrors retrievalTerms()'s suffix list, checked longest-safe first
// exactly as Kotlin's firstOrNull over this literal order (order matters: longer suffixes
// like "으로"/"에서" must be tried before shorter ones such as "로"/"서" would falsely match
// a substring, and Kotlin's list order is preserved here unchanged).
var retrievalSuffixes = []string{"으로", "에서", "에게", "까지", "부터", "의", "에", "은", "는", "이", "가", "을", "를", "과", "와", "도"}

// RetrievalTerms mirrors private fun retrievalTerms(text: String): Set<String>.
func RetrievalTerms(text string) map[string]bool {
	lower := strings.ToLower(text)
	matches := retrievalTermPattern.FindAllString(lower, -1)
	terms := make(map[string]bool)
	for _, term := range matches {
		runes := []rune(term)
		stripped := term
		for _, suffix := range retrievalSuffixes {
			sRunes := []rune(suffix)
			if len(runes) > len(sRunes)+1 && strings.HasSuffix(term, suffix) {
				stripped = string(runes[:len(runes)-len(sRunes)])
				break
			}
		}
		if len([]rune(stripped)) >= 2 {
			terms[stripped] = true
		}
	}
	return terms
}

// LexicalCoverage mirrors internal fun lexicalCoverage(query, text): Double.
func LexicalCoverage(query, text string) float64 {
	queryTerms := RetrievalTerms(query)
	if len(queryTerms) == 0 {
		return 0.0
	}
	textTerms := RetrievalTerms(text)
	intersect := 0
	for t := range queryTerms {
		if textTerms[t] {
			intersect++
		}
	}
	return float64(intersect) / float64(len(queryTerms))
}
