package tools

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// kgTokenSplit mirrors kgSearch's raw split regex: [\s,.?!'"()]+
var kgTokenSplit = regexp.MustCompile(`[\s,.?!'"()]+`)

// kgParticleSuffixes mirrors the Korean particle list stripped in kgSearch, in the same order.
var kgParticleSuffixes = []string{"은", "는", "이", "가", "을", "를", "의", "에", "에서", "으로", "로", "와", "과", "도"}

var graphStopTokens = map[string]bool{
	"누구": true, "무엇": true, "알려줘": true, "확인해줘": true, "현재": true, "실제": true, "하나": true, "이상": true,
}

// predicateKeywords mirrors PREDICATE_KEYWORDS (Set<Pair<String,String>> preserving insertion order).
var predicateKeywordOrder = []string{"담당", "사용", "소속", "이끈", "이끌", "보고", "팀장", "진행"}
var predicateKeywordMap = map[string]string{
	"담당": "담당한다",
	"사용": "사용한다",
	"소속": "소속",
	"이끈": "이끈다",
	"이끌": "이끈다",
	"보고": "이슈보고",
	"팀장": "부서장",
	"진행": "프로젝트",
}

var expansionTriggers = []string{"2홉", "간접", "연쇄", "거쳐", "연결된 프로젝트"}

// kgQueryPlan is the pure, testable core of RetrievalTools.kgSearch: everything up to
// building the SQL WHERE clause and params, before hitting the database.
type kgQueryPlan struct {
	Tokens            []string
	EntityTokens      []string
	MatchedPredicates []string
	Empty             bool // true => tool returns [] without querying the DB
	Where             string
	Params            []any
}

func stripKoreanParticle(token string) string {
	runes := []rune(token)
	for _, suffix := range kgParticleSuffixes {
		sRunes := []rune(suffix)
		if len(runes) > len(sRunes)+2 && strings.HasSuffix(token, suffix) {
			return string(runes[:len(runes)-len(sRunes)])
		}
	}
	return token
}

func isEntityToken(token string) bool {
	if strings.Contains(token, "-") {
		return true
	}
	for _, suf := range []string{"팀", "부", "부서", "사업부"} {
		if strings.HasSuffix(token, suf) {
			return true
		}
	}
	for _, r := range token {
		if r >= 'A' && r <= 'Z' {
			return true
		}
	}
	return false
}

// planKgSearch mirrors RetrievalTools.kgSearch's pure logic (tokens through WHERE clause).
func planKgSearch(query string) kgQueryPlan {
	rawParts := kgTokenSplit.Split(query, -1)
	seen := make(map[string]bool)
	var rawTokens []string
	for _, p := range rawParts {
		p = strings.TrimSpace(p)
		if len([]rune(p)) < 2 {
			continue
		}
		stripped := stripKoreanParticle(p)
		if !seen[stripped] {
			seen[stripped] = true
			rawTokens = append(rawTokens, stripped)
		}
	}

	var entityTokens []string
	for _, t := range rawTokens {
		if isEntityToken(t) {
			entityTokens = append(entityTokens, t)
		}
	}

	var matchedPredicates []string
	for _, k := range predicateKeywordOrder {
		if strings.Contains(query, k) {
			matchedPredicates = append(matchedPredicates, predicateKeywordMap[k])
		}
	}

	tokens := entityTokens
	if len(tokens) == 0 {
		for _, t := range rawTokens {
			if !graphStopTokens[t] {
				tokens = append(tokens, t)
			}
		}
	}
	if len(tokens) > 4 {
		tokens = tokens[:4]
	}

	if len(tokens) == 0 && len(matchedPredicates) == 0 {
		return kgQueryPlan{Tokens: tokens, EntityTokens: entityTokens, MatchedPredicates: matchedPredicates, Empty: true}
	}

	var tokenWhereParts []string
	var tokenParams []any
	for _, t := range tokens {
		tokenWhereParts = append(tokenWhereParts, "subject ILIKE ? OR object ILIKE ? OR ? ILIKE '%' || subject || '%' OR ? ILIKE '%' || object || '%'")
		like := "%" + t + "%"
		tokenParams = append(tokenParams, like, like, t, t)
	}
	var tokenWhere string
	if len(tokenWhereParts) > 0 {
		tokenWhere = strings.Join(tokenWhereParts, " OR ")
	}

	var predicateWhereParts []string
	for range matchedPredicates {
		predicateWhereParts = append(predicateWhereParts, "predicate = ?")
	}
	var predicateWhere string
	if len(predicateWhereParts) > 0 {
		predicateWhere = strings.Join(predicateWhereParts, " OR ")
	}

	hasSpecificEntity := len(entityTokens) > 0
	var where string
	switch {
	case hasSpecificEntity && predicateWhere != "":
		where = fmt.Sprintf("(%s) AND (%s)", tokenWhere, predicateWhere)
	default:
		var clauses []string
		if tokenWhere != "" {
			clauses = append(clauses, tokenWhere)
		}
		if predicateWhere != "" {
			clauses = append(clauses, predicateWhere)
		}
		where = strings.Join(clauses, " OR ")
	}

	params := append(tokenParams, toAnySlice(matchedPredicates)...)

	return kgQueryPlan{
		Tokens:            tokens,
		EntityTokens:      entityTokens,
		MatchedPredicates: matchedPredicates,
		Where:             where,
		Params:            params,
	}
}

func toAnySlice(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

func requiresExpansion(query string) bool {
	for _, trigger := range expansionTriggers {
		if strings.Contains(query, trigger) {
			return true
		}
	}
	return false
}

// KgTriple mirrors a row from kg_triples.
type KgTriple struct {
	Subject   string
	Predicate string
	Object    string
}

func (t KgTriple) key() string { return t.Subject + "|" + t.Predicate + "|" + t.Object }

// KgSearch ports RetrievalTools.kgSearch's full behavior including the direct query,
// optional 2-hop expansion, dedup, and 40-item cap. Returns the formatted
// "subject --[predicate]--> object" strings, matching the Kotlin output shape exactly.
func KgSearch(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger, query string) ([]string, error) {
	logger.Info("[kg_search]", "query", query)
	plan := planKgSearch(query)
	logger.Info("[kg_search]", "rawTokens", plan.Tokens, "entityTokens", plan.EntityTokens,
		"tokens", plan.Tokens, "matchedPredicates", plan.MatchedPredicates)

	if plan.Empty {
		logger.Info("[kg_search] Early return: no tokens and no predicates")
		return []string{}, nil
	}

	logger.Info("[kg_search] SQL WHERE", "where", plan.Where, "params", plan.Params)

	direct, err := queryTriples(ctx, pool, fmt.Sprintf(
		"SELECT subject, predicate, object FROM kg_triples WHERE %s LIMIT 30", rebindPlaceholders(plan.Where)),
		plan.Params...)
	if err != nil {
		return nil, err
	}
	logger.Info("[kg_search] direct results", "count", len(direct))

	entitySet := make(map[string]bool)
	var entities []string
	for _, t := range direct {
		for _, e := range []string{t.Subject, t.Object} {
			if !entitySet[e] {
				entitySet[e] = true
				entities = append(entities, e)
			}
		}
	}

	var neighbors []KgTriple
	if len(entities) > 0 && requiresExpansion(query) {
		placeholders := make([]string, len(entities))
		params := make([]any, 0, len(entities)*2)
		for i, e := range entities {
			placeholders[i] = "?"
			params = append(params, e)
		}
		for _, e := range entities {
			params = append(params, e)
		}
		inClause := strings.Join(placeholders, ",")
		sql := fmt.Sprintf(
			"SELECT subject, predicate, object FROM kg_triples WHERE subject IN (%s) OR object IN (%s) LIMIT 30",
			inClause, inClause)
		neighbors, err = queryTriples(ctx, pool, rebindPlaceholders(sql), params...)
		if err != nil {
			return nil, err
		}
	}

	seen := make(map[string]bool)
	result := make([]string, 0, 40)
	for _, t := range append(append([]KgTriple{}, direct...), neighbors...) {
		k := t.key()
		if seen[k] {
			continue
		}
		seen[k] = true
		result = append(result, fmt.Sprintf("%s --[%s]--> %s", t.Subject, t.Predicate, t.Object))
		if len(result) == 40 {
			break
		}
	}
	return result, nil
}

// rebindPlaceholders converts "?" positional placeholders (used to keep planKgSearch's
// SQL construction readable and directly comparable to the Kotlin source) into pgx's
// "$1, $2, ..." style.
func rebindPlaceholders(sql string) string {
	i := 0
	var b strings.Builder
	for _, r := range sql {
		if r == '?' {
			i++
			fmt.Fprintf(&b, "$%d", i)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func queryTriples(ctx context.Context, pool *pgxpool.Pool, sql string, params ...any) ([]KgTriple, error) {
	rows, err := pool.Query(ctx, sql, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []KgTriple
	for rows.Next() {
		var t KgTriple
		if err := rows.Scan(&t.Subject, &t.Predicate, &t.Object); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
