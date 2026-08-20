// Package sql ports com.riwonace.agent.sql from the Kotlin/Spring AI baseline.
package sql

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	productPattern    = regexp.MustCompile(`(?i)Product-[A-Z0-9]+`)
	clientPattern     = regexp.MustCompile(`(?i)Client-[A-Z0-9]+`)
	departmentPattern = regexp.MustCompile(`[\x{AC00}-\x{D7A3}A-Za-z0-9]+(?:사업부|부서|팀)`)
	categoryPattern   = regexp.MustCompile(`(?i)(?:cloud|data|security|consulting)`)
	categoryKrPattern = regexp.MustCompile(`(?i)(?:보안(?: 솔루션)?|security|클라우드|cloud|데이터|data|컨설팅|consulting)`)
	regionPattern     = regexp.MustCompile(`서울|부산|대전|광주|인천|대구`)
	quarterPattern    = regexp.MustCompile(`(20\d{2})\s*년?\s*([1-4])\s*분기`)
	yearPattern       = regexp.MustCompile(`(20\d{2})\s*년`)
	activeAmountRe    = regexp.MustCompile(`활성\s*계약[^0-9]{0,12}([0-9][0-9,]*)`)
	activeCountRe     = regexp.MustCompile(`활성\s*계약[^0-9]{0,12}([0-9][0-9,]*)\s*건`)
	monthlyPriceRe    = regexp.MustCompile(`월\s*([0-9][0-9,]*)`)
)

// DeterministicSqlPlanner ports DeterministicSqlPlanner.kt 1:1: compiles high-confidence
// Company-X question shapes directly to SQL, returning "" (nil in Kotlin) for anything
// outside those patterns so the caller falls through to LLM NL2SQL.
type DeterministicSqlPlanner struct{}

// Plan mirrors fun plan(question: String): String?. A nil return means "not matched".
func (p *DeterministicSqlPlanner) Plan(question string) *string {
	q := strings.ToLower(question)
	product := findMatch(productPattern, question)
	client := findMatch(clientPattern, question)
	department := findMatch(departmentPattern, question)

	if product != "" {
		literal := quote(product)
		var sql string
		switch {
		case isActiveContractAmount(q):
			sql = "SELECT sum(c.amount) AS total_amount FROM contracts c JOIN products p ON c.product_id = p.id " +
				"WHERE c.status = 'active' AND p.name = " + literal
		case isActiveContractCount(q):
			sql = "SELECT count(*) AS count FROM contracts c JOIN products p ON c.product_id = p.id " +
				"WHERE c.status = 'active' AND p.name = " + literal
		case isTotalSales(q):
			sql = "SELECT sum(s.amount) AS total_sales FROM sales s JOIN products p ON s.product_id = p.id " +
				"WHERE p.name = " + literal
		case isMonthlyPrice(q):
			sql = "SELECT price_monthly FROM products WHERE name = " + literal
		case isReleaseStatus(q):
			sql = "SELECT status FROM products WHERE name = " + literal
		default:
			return nil
		}
		return &sql
	}

	if client != "" && isTotalSales(q) {
		sql := "SELECT sum(s.amount) AS total_sales FROM sales s JOIN clients c ON s.client_id = c.id " +
			"WHERE c.name = " + quote(client)
		return &sql
	}

	if department != "" && isAverageSalary(q) {
		sql := "SELECT avg(e.salary) AS average_salary FROM employees e " +
			"JOIN departments d ON e.dept_id = d.id WHERE d.name = " + quote(department)
		return &sql
	}

	if isTopClientsByRegion(q) {
		region := findMatch(regionPattern, question)
		if region == "" {
			region = "서울"
		}
		sql := "SELECT c.name, sum(s.amount) AS total_sales FROM clients c " +
			"JOIN sales s ON s.client_id = c.id WHERE s.region = " + quote(region) +
			" GROUP BY c.id, c.name ORDER BY total_sales DESC LIMIT 5"
		return &sql
	}
	if isQuarterSales(q) {
		match := quarterPattern.FindStringSubmatch(question)
		quarter := "2025-Q3"
		if match != nil {
			quarter = match[1] + "-Q" + match[2]
		}
		sql := "SELECT sum(amount) AS total_sales FROM sales WHERE quarter = " + quote(quarter)
		return &sql
	}
	if isCategoryAverageSales(q) {
		category := "security"
		if m := findMatch(categoryKrPattern, question); m != "" {
			category = normalizeCategory(m)
		}
		sql := "SELECT avg(s.amount) AS average_sales FROM sales s " +
			"JOIN products p ON p.id = s.product_id WHERE p.category = " + quote(category)
		return &sql
	}
	if isActiveContractCount(q) && !strings.Contains(q, "제품") && !strings.Contains(q, "category") && !strings.Contains(q, "카테고리") {
		sql := "SELECT count(*) AS count FROM contracts WHERE status = 'active'"
		return &sql
	}
	if isDepartmentEmployees(q) {
		dept := findMatch(departmentPattern, question)
		if dept == "" {
			return nil
		}
		sql := "SELECT e.name, e.salary FROM employees e JOIN departments d ON d.id = e.dept_id " +
			"WHERE d.name = " + quote(dept) + " ORDER BY e.name"
		return &sql
	}
	if isTopProjectClient(q) {
		sql := "SELECT c.name, count(*) AS project_count FROM projects p JOIN clients c ON c.id = p.client_id " +
			"WHERE p.status = 'in_progress' GROUP BY c.id, c.name ORDER BY project_count DESC LIMIT 1"
		return &sql
	}
	if isUnresolvedCritical(q) {
		sql := "SELECT count(*) AS count FROM support_tickets WHERE priority = 'critical' " +
			"AND status IN ('open', 'in_progress')"
		return &sql
	}
	if isProductContractTotals(q) {
		sql := "SELECT p.name, sum(c.amount) AS total_amount FROM contracts c JOIN products p ON p.id = c.product_id " +
			"GROUP BY p.id, p.name ORDER BY total_amount DESC"
		return &sql
	}
	if isRegisteredClients(q) {
		year := "2024"
		if m := yearPattern.FindStringSubmatch(question); m != nil {
			year = m[1]
		}
		yearInt, _ := strconv.Atoi(year)
		sql := fmt.Sprintf(
			"SELECT count(*) AS count FROM clients WHERE registered_at >= '%s-01-01' AND registered_at < '%d-01-01'",
			year, yearInt+1,
		)
		return &sql
	}
	if isHighestDepartmentSalary(q) {
		sql := "SELECT d.name, avg(e.salary) AS average_salary FROM departments d JOIN employees e ON e.dept_id = d.id " +
			"GROUP BY d.id, d.name ORDER BY average_salary DESC LIMIT 1"
		return &sql
	}

	category := findMatch(categoryPattern, q)
	if category != "" {
		if isActiveContractAmount(q) {
			if m := activeAmountRe.FindStringSubmatch(question); m != nil {
				if amount := toIntValue(m[1]); amount != nil {
					sql := "SELECT p.name, sum(c.amount) AS total_amount FROM contracts c JOIN products p ON c.product_id = p.id " +
						"WHERE c.status = 'active' AND p.category = " + quote(category) +
						fmt.Sprintf(" GROUP BY p.id, p.name HAVING sum(c.amount) = %d", *amount)
					return &sql
				}
			}
		}
		if isActiveContractCount(q) {
			if m := activeCountRe.FindStringSubmatch(question); m != nil {
				if count := toIntValue(m[1]); count != nil {
					sql := "SELECT p.name, count(*) AS active_count FROM contracts c JOIN products p ON c.product_id = p.id " +
						"WHERE c.status = 'active' AND p.category = " + quote(category) +
						fmt.Sprintf(" GROUP BY p.id, p.name HAVING count(*) = %d", *count)
					return &sql
				}
			}
		}
		if m := monthlyPriceRe.FindStringSubmatch(question); m != nil {
			if price := toIntValue(m[1]); price != nil {
				sql := fmt.Sprintf("SELECT name, price_monthly FROM products WHERE category = %s AND price_monthly = %d",
					quote(category), *price)
				return &sql
			}
		}
	}

	return nil
}

func findMatch(re *regexp.Regexp, s string) string {
	return re.FindString(s)
}

func isMonthlyPrice(q string) bool { return strings.Contains(q, "가격") || strings.Contains(q, "price") }
func isReleaseStatus(q string) bool {
	return strings.Contains(q, "출시 상태") || strings.Contains(q, "release status")
}
func isActiveContractCount(q string) bool {
	return strings.Contains(q, "활성") && strings.Contains(q, "계약") && containsAnyStr(q, "수", "건", "개")
}
func isActiveContractAmount(q string) bool {
	return strings.Contains(q, "활성") && strings.Contains(q, "계약") && containsAnyStr(q, "금액", "합계", "총액")
}
func isTotalSales(q string) bool {
	return strings.Contains(q, "매출") && containsAnyStr(q, "총", "전체", "합계")
}
func isAverageSalary(q string) bool {
	return strings.Contains(q, "평균") && (strings.Contains(q, "급여") || strings.Contains(q, "연봉"))
}
func isTopClientsByRegion(q string) bool {
	return strings.Contains(q, "고객사") && (strings.Contains(q, "상위") || strings.Contains(q, "큰")) && strings.Contains(q, "서울")
}
func isQuarterSales(q string) bool { return strings.Contains(q, "분기") && strings.Contains(q, "매출") }
func isCategoryAverageSales(q string) bool {
	return strings.Contains(q, "카테고리") && strings.Contains(q, "평균") && strings.Contains(q, "매출")
}
func isDepartmentEmployees(q string) bool {
	return strings.Contains(q, "직원") && (strings.Contains(q, "목록") || strings.Contains(q, "누구")) && departmentPattern.MatchString(q)
}
func isTopProjectClient(q string) bool {
	return strings.Contains(q, "프로젝트") && (strings.Contains(q, "가장 많은") || strings.Contains(q, "많이")) && strings.Contains(q, "고객사")
}
func isUnresolvedCritical(q string) bool {
	return strings.Contains(q, "critical") && (strings.Contains(q, "해결되지") || strings.Contains(q, "미해결"))
}
func isProductContractTotals(q string) bool {
	return strings.Contains(q, "제품별") && strings.Contains(q, "계약") && (strings.Contains(q, "금액") || strings.Contains(q, "합계"))
}
func isRegisteredClients(q string) bool {
	return strings.Contains(q, "등록") && strings.Contains(q, "고객사") && (strings.Contains(q, "몇") || strings.Contains(q, "수"))
}
func isHighestDepartmentSalary(q string) bool {
	return strings.Contains(q, "평균 연봉") && (strings.Contains(q, "높은") || strings.Contains(q, "가장")) && strings.Contains(q, "부서")
}

func containsAnyStr(q string, options ...string) bool {
	for _, o := range options {
		if strings.Contains(q, o) {
			return true
		}
	}
	return false
}

func quote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func normalizeCategory(value string) string {
	switch strings.ToLower(value) {
	case "보안", "보안 솔루션":
		return "security"
	case "클라우드":
		return "cloud"
	case "데이터":
		return "data"
	case "컨설팅":
		return "consulting"
	default:
		return value
	}
}

func toIntValue(s string) *int64 {
	cleaned := strings.ReplaceAll(s, ",", "")
	n, err := strconv.ParseInt(cleaned, 10, 64)
	if err != nil {
		return nil
	}
	return &n
}
