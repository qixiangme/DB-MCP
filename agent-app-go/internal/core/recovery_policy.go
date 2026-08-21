package core

import (
	"strings"

	"github.com/riwonace/agent-app-go/internal/router"
)

type StrategyType string

const (
	StrategyRetrySame        StrategyType = "RETRY_SAME"
	StrategyRetryModified    StrategyType = "RETRY_MODIFIED"
	StrategyFallbackRoute    StrategyType = "FALLBACK_ROUTE"
	StrategyUseCache         StrategyType = "USE_CACHE"
	StrategyPartialResponse  StrategyType = "PARTIAL_RESPONSE"
	StrategyAskClarification StrategyType = "ASK_CLARIFICATION"
	StrategyGiveUp           StrategyType = "GIVE_UP"
)

// RecoveryStrategy mirrors data class RecoveryStrategy (query-transform closures are
// omitted here since AgentServiceV2's port never invokes them programmatically either --
// see the Kotlin comment "외부에서 에러 피드백과 함께 처리").
type RecoveryStrategy struct {
	Type           StrategyType
	MaxRetries     int
	BackoffMs      int64
	FallbackRoutes []router.Route
}

// FailureClassification mirrors data class FailureClassification.
type FailureClassification struct {
	Type        FailureType
	Severity    int
	Recoverable bool
	Evidence    string
}

// RecoveryPolicy ports RecoveryPolicy.kt 1:1.
type RecoveryPolicy struct{}

func (p *RecoveryPolicy) ClassifyFailure(errMsg string, route router.Route) FailureClassification {
	errorLower := strings.ToLower(errMsg)

	switch {
	case strings.Contains(errorLower, "relation") && strings.Contains(errorLower, "does not exist"):
		return FailureClassification{FailureSQLSchemaError, 3, true, "테이블/컬럼 미존재"}
	case strings.Contains(errorLower, "column") && strings.Contains(errorLower, "does not exist"):
		return FailureClassification{FailureSQLSchemaError, 3, true, "컬럼 미존재"}
	case strings.Contains(errorLower, "syntax error") || strings.Contains(errorLower, "parse error"):
		return FailureClassification{FailureSQLSyntaxError, 2, true, "SQL 문법 오류"}
	case strings.Contains(errorLower, "permission denied"):
		return FailureClassification{FailureSQLSchemaError, 4, false, "권한 부족"}
	case strings.Contains(errorLower, "no results") || strings.Contains(errorLower, "not found") ||
		strings.Contains(errorLower, "0행") || strings.Contains(errorLower, "empty"):
		return FailureClassification{FailureRetrievalEmpty, 2, true, "검색 결과 없음"}
	case strings.Contains(errorLower, "timeout") || strings.Contains(errorLower, "timed out"):
		return FailureClassification{FailureMCPTimeout, 3, true, "타임아웃"}
	case strings.Contains(errorLower, "connection") || strings.Contains(errorLower, "refused") ||
		strings.Contains(errorLower, "unreachable"):
		return FailureClassification{FailureMCPConnectionErr, 4, true, "연결 실패"}
	case strings.Contains(errorLower, "conflict") || strings.Contains(errorLower, "inconsistent"):
		return FailureClassification{FailureEvidenceConflict, 2, true, "증거 충돌"}
	case route == router.RouteVector && strings.Contains(errorLower, "no match"):
		return FailureClassification{FailureRouteMiss, 2, true, "라우트 미매칭"}
	default:
		evidence := errMsg
		if len([]rune(evidence)) > 50 {
			evidence = string([]rune(evidence)[:50])
		}
		return FailureClassification{FailureUnknown, 3, true, "분류 불가: " + evidence}
	}
}

func (p *RecoveryPolicy) DetermineStrategy(c FailureClassification, currentRoute router.Route, retryCount int) RecoveryStrategy {
	if !c.Recoverable || retryCount >= 3 {
		return RecoveryStrategy{Type: StrategyGiveUp}
	}

	switch c.Type {
	case FailureRouteMiss:
		fallbacks := getFallbackRoutes(currentRoute)
		return RecoveryStrategy{Type: StrategyFallbackRoute, MaxRetries: len(fallbacks), FallbackRoutes: fallbacks}

	case FailureRetrievalEmpty:
		return RecoveryStrategy{Type: StrategyRetryModified, MaxRetries: 2}

	case FailureSQLSchemaError:
		return RecoveryStrategy{Type: StrategyRetryModified, MaxRetries: 2, FallbackRoutes: []router.Route{router.RouteVector}}

	case FailureSQLSyntaxError:
		return RecoveryStrategy{Type: StrategyRetryModified, MaxRetries: 2}

	case FailureMCPTimeout:
		if retryCount == 0 {
			return RecoveryStrategy{Type: StrategyRetrySame, MaxRetries: 1, BackoffMs: 2000}
		}
		return RecoveryStrategy{Type: StrategyFallbackRoute, MaxRetries: 1, FallbackRoutes: getFallbackRoutes(currentRoute)}

	case FailureMCPConnectionErr:
		return RecoveryStrategy{Type: StrategyFallbackRoute, MaxRetries: 1, BackoffMs: 1000, FallbackRoutes: getFallbackRoutes(currentRoute)}

	case FailureEvidenceConflict:
		return RecoveryStrategy{Type: StrategyPartialResponse}

	case FailureUnknown:
		if retryCount == 0 {
			return RecoveryStrategy{Type: StrategyRetrySame, MaxRetries: 1, BackoffMs: 500}
		}
		return RecoveryStrategy{Type: StrategyGiveUp}

	default:
		return RecoveryStrategy{Type: StrategyGiveUp}
	}
}

func getFallbackRoutes(currentRoute router.Route) []router.Route {
	switch currentRoute {
	case router.RouteSQL:
		return []router.Route{router.RouteVector, router.RouteGraph}
	case router.RouteVector:
		return []router.Route{router.RouteGraph, router.RouteSQL}
	case router.RouteGraph:
		return []router.Route{router.RouteVector, router.RouteSQL}
	default:
		return nil
	}
}
