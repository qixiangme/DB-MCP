package sql

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

// SqlExample mirrors data class SqlExample.
type SqlExample struct {
	Question string
	SQL      string
	Pattern  string
	Keywords []string
}

// examplePool mirrors FewShotSelector.kt's hardcoded examplePool, in the same order.
var examplePool = []SqlExample{
	{"완료된 프로젝트는 몇 개야?", "SELECT count(*) FROM projects WHERE status = 'completed'", "count-filter", []string{"몇 개", "개수", "수", "count"}},
	{"경영지원팀 직원 이름과 연봉을 알려줘", "SELECT e.name, e.salary FROM employees e JOIN departments d ON e.dept_id = d.id WHERE d.name = '경영지원팀'", "join-filter", []string{"팀", "부서", "직원"}},
	{"부서별 직원 수는?", "SELECT d.name, count(*) FROM employees e JOIN departments d ON e.dept_id = d.id GROUP BY d.name", "group-count", []string{"별", "각", "그룹"}},
	{"전체 계약 금액 합계는?", "SELECT sum(amount) FROM contracts WHERE status = 'active'", "sum", []string{"합계", "총", "전체", "sum"}},
	{"활성 계약은 몇 건이야?", "SELECT count(*) FROM contracts WHERE status = 'active'", "active-contract-count", []string{"활성", "계약", "몇", "개", "건", "수"}},
	{"평균 연봉은 얼마야?", "SELECT avg(salary) FROM employees", "avg", []string{"평균", "avg"}},
	{"가장 비싼 월 구독 제품은?", "SELECT name, price_monthly FROM products ORDER BY price_monthly DESC LIMIT 1", "max-order", []string{"가장", "최고", "최대", "max"}},
	{"가장 싼 월 구독 제품은?", "SELECT name, price_monthly FROM products ORDER BY price_monthly ASC LIMIT 1", "min-order", []string{"가장", "최저", "최소", "min"}},
	{"서울 지역 활성 고객사 목록은?", "SELECT name FROM clients WHERE region = '서울' AND is_active = true", "multi-filter", []string{"지역", "활성", "목록"}},
	{"2025년 신규 계약은 몇 건이야?", "SELECT count(*) FROM contracts WHERE EXTRACT(YEAR FROM created_at) = 2025", "date-filter", []string{"년", "월", "일", "날짜", "기간"}},
	{"평균 이상 연봉 받는 직원은?", "SELECT name, salary FROM employees WHERE salary > (SELECT avg(salary) FROM employees)", "subquery", []string{"이상", "초과", "보다", "평균"}},
	{"프로젝트가 없는 고객사는?", "SELECT name FROM clients WHERE id NOT IN (SELECT DISTINCT client_id FROM projects)", "not-in", []string{"없", "않", "제외", "아닌"}},
	{"담당자가 배정되지 않은 티켓은?", "SELECT id, title FROM support_tickets WHERE assignee_id IS NULL", "null-check", []string{"없", "미배정", "null", "배정되지"}},
	{"부산 지역 고객사별 매출 합계를 큰 순서로 보여줘", "SELECT c.name, sum(s.amount) AS total_sales FROM sales s JOIN clients c ON s.client_id = c.id WHERE s.region = '부산' GROUP BY c.id, c.name ORDER BY total_sales DESC", "sales-client-ranking", []string{"매출", "고객사", "지역", "상위", "순서"}},
	{"2024년 2분기 매출 합계는?", "SELECT sum(amount) FROM sales WHERE quarter = '2024-Q2'", "quarter-sales", []string{"분기", "매출", "합계", "총"}},
	{"클라우드 카테고리의 건당 평균 매출은?", "SELECT avg(amount) FROM sales WHERE category = 'cloud'", "category-sales-average", []string{"카테고리", "평균", "매출"}},
	{"고객사별 진행 중 프로젝트 수를 많은 순서로 보여줘", "SELECT c.name, count(*) AS project_count FROM projects p JOIN clients c ON p.client_id = c.id WHERE p.status = 'in_progress' GROUP BY c.id, c.name ORDER BY project_count DESC", "project-client-ranking", []string{"프로젝트", "고객사", "가장", "많은", "진행 중"}},
	{"해결되지 않은 High 우선순위 티켓 수는?", "SELECT count(*) FROM support_tickets WHERE priority = 'high' AND status IN ('open', 'in_progress')", "unresolved-ticket-count", []string{"티켓", "우선순위", "해결", "건", "수"}},
	{"제품별 계약 합계를 큰 순서로 보여줘", "SELECT p.name, sum(c.amount) AS total_amount FROM contracts c JOIN products p ON c.product_id = p.id GROUP BY p.id, p.name ORDER BY total_amount DESC", "product-contract-sum", []string{"제품별", "계약", "금액", "합계", "순서"}},
	{"2023년에 등록한 고객사 수는?", "SELECT count(*) FROM clients WHERE registered_at >= DATE '2023-01-01' AND registered_at < DATE '2024-01-01'", "client-registration-year", []string{"등록", "고객사", "년", "몇", "수"}},
	{"부서별 평균 연봉을 높은 순서로 보여줘", "SELECT d.name, avg(e.salary) AS average_salary FROM employees e JOIN departments d ON e.dept_id = d.id GROUP BY d.id, d.name ORDER BY average_salary DESC", "department-salary-ranking", []string{"부서", "평균", "연봉", "높은", "가장"}},
}

var tokenizeRe = regexp.MustCompile(`[^\x{AC00}-\x{D7A3}a-z0-9\s]`)

// FewShotSelector ports FewShotSelector.kt 1:1: keyword×0.5 + Jaccard×0.25 + cosine×0.25
// weighted similarity ranking over the hardcoded example pool.
type FewShotSelector struct{}

func (s *FewShotSelector) SelectExamples(question string, topK int) []SqlExample {
	type scored struct {
		example SqlExample
		score   float64
	}
	scores := make([]scored, len(examplePool))
	for i, ex := range examplePool {
		scores[i] = scored{ex, calculateSimilarity(question, ex)}
	}
	sort.SliceStable(scores, func(i, j int) bool { return scores[i].score > scores[j].score })

	if topK > len(scores) {
		topK = len(scores)
	}
	out := make([]SqlExample, topK)
	for i := 0; i < topK; i++ {
		out[i] = scores[i].example
	}
	return out
}

func calculateSimilarity(question string, example SqlExample) float64 {
	questionTokens := tokenize(question)
	exampleTokens := tokenize(example.Question)

	matchCount := 0
	for _, k := range example.Keywords {
		if strings.Contains(strings.ToLower(question), strings.ToLower(k)) {
			matchCount++
		}
	}
	denom := len(example.Keywords)
	if denom < 1 {
		denom = 1
	}
	keywordScore := float64(matchCount) / float64(denom)

	intersection := setIntersectionSize(questionTokens, exampleTokens)
	union := setUnionSize(questionTokens, exampleTokens)
	jaccardScore := 0.0
	if union > 0 {
		jaccardScore = float64(intersection) / float64(union)
	}

	cosineScore := cosineSimilarity(questionTokens, exampleTokens)

	return keywordScore*0.5 + jaccardScore*0.25 + cosineScore*0.25
}

func tokenize(text string) map[string]bool {
	lower := strings.ToLower(text)
	replaced := tokenizeRe.ReplaceAllString(lower, " ")
	parts := strings.Fields(replaced)
	set := make(map[string]bool)
	for _, p := range parts {
		if len([]rune(p)) >= 2 {
			set[p] = true
		}
	}
	return set
}

func setIntersectionSize(a, b map[string]bool) int {
	n := 0
	for k := range a {
		if b[k] {
			n++
		}
	}
	return n
}

func setUnionSize(a, b map[string]bool) int {
	union := make(map[string]bool, len(a)+len(b))
	for k := range a {
		union[k] = true
	}
	for k := range b {
		union[k] = true
	}
	return len(union)
}

func cosineSimilarity(a, b map[string]bool) float64 {
	all := make(map[string]bool, len(a)+len(b))
	for k := range a {
		all[k] = true
	}
	for k := range b {
		all[k] = true
	}

	var dot, normA, normB float64
	for k := range all {
		va, vb := 0.0, 0.0
		if a[k] {
			va = 1.0
		}
		if b[k] {
			vb = 1.0
		}
		dot += va * vb
		normA += va * va
		normB += vb * vb
	}
	if normA > 0 && normB > 0 {
		return dot / (math.Sqrt(normA) * math.Sqrt(normB))
	}
	return 0.0
}

func (s *FewShotSelector) FormatExamplesForPrompt(examples []SqlExample) string {
	lines := make([]string, len(examples))
	for i, ex := range examples {
		lines[i] = fmt.Sprintf("예시%d — 질문: %s\nSQL: %s", i+1, ex.Question, ex.SQL)
	}
	return strings.Join(lines, "\n")
}
