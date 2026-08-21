package core

import (
	"testing"

	"github.com/riwonace/agent-app-go/internal/router"
)

func TestRecoveryPolicy_MissingTableClassifiedSchemaError(t *testing.T) {
	p := &RecoveryPolicy{}
	c := p.ClassifyFailure(`ERROR: relation "non_existent_table" does not exist`, router.RouteSQL)
	if c.Type != FailureSQLSchemaError || !c.Recoverable {
		t.Fatalf("got %+v", c)
	}
}

func TestRecoveryPolicy_MissingColumnClassifiedSchemaError(t *testing.T) {
	p := &RecoveryPolicy{}
	c := p.ClassifyFailure(`ERROR: column "wrong_column" does not exist`, router.RouteSQL)
	if c.Type != FailureSQLSchemaError {
		t.Fatalf("got %+v", c)
	}
}

func TestRecoveryPolicy_SqlSyntaxErrorClassified(t *testing.T) {
	p := &RecoveryPolicy{}
	c := p.ClassifyFailure(`syntax error at or near "SELEC"`, router.RouteSQL)
	if c.Type != FailureSQLSyntaxError || !c.Recoverable {
		t.Fatalf("got %+v", c)
	}
}

func TestRecoveryPolicy_EmptyResultClassifiedRetrievalEmpty(t *testing.T) {
	p := &RecoveryPolicy{}
	c := p.ClassifyFailure("조회 결과가 0행입니다", router.RouteSQL)
	if c.Type != FailureRetrievalEmpty {
		t.Fatalf("got %+v", c)
	}
}

func TestRecoveryPolicy_TimeoutClassifiedMcpTimeout(t *testing.T) {
	p := &RecoveryPolicy{}
	c := p.ClassifyFailure("Request timed out after 30 seconds", router.RouteVector)
	if c.Type != FailureMCPTimeout {
		t.Fatalf("got %+v", c)
	}
}

func TestRecoveryPolicy_ConnectionErrorClassifiedMcpConnectionError(t *testing.T) {
	p := &RecoveryPolicy{}
	c := p.ClassifyFailure("Connection refused to MCP server", router.RouteSQL)
	if c.Type != FailureMCPConnectionErr {
		t.Fatalf("got %+v", c)
	}
}

func TestRecoveryPolicy_PermissionErrorClassifiedUnrecoverable(t *testing.T) {
	p := &RecoveryPolicy{}
	c := p.ClassifyFailure("permission denied for table users", router.RouteSQL)
	if c.Recoverable {
		t.Fatal("expected unrecoverable")
	}
}

func TestRecoveryPolicy_RouteMissFallsBackToAlternateRoute(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureRouteMiss, 2, true, "라우트 미매칭"}
	s := p.DetermineStrategy(c, router.RouteVector, 0)
	if s.Type != StrategyFallbackRoute || len(s.FallbackRoutes) == 0 {
		t.Fatalf("got %+v", s)
	}
}

func TestRecoveryPolicy_RetrievalEmptyRetriesWithRelaxedQuery(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureRetrievalEmpty, 2, true, "검색 결과 없음"}
	s := p.DetermineStrategy(c, router.RouteVector, 0)
	if s.Type != StrategyRetryModified {
		t.Fatalf("got %+v", s)
	}
}

func TestRecoveryPolicy_SqlSchemaErrorRetriesAfterSchemaRecheck(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureSQLSchemaError, 3, true, "테이블 미존재"}
	s := p.DetermineStrategy(c, router.RouteSQL, 0)
	if s.Type != StrategyRetryModified {
		t.Fatalf("got %+v", s)
	}
	if !containsRoute(s.FallbackRoutes, router.RouteVector) {
		t.Fatalf("got %+v", s.FallbackRoutes)
	}
}

func TestRecoveryPolicy_McpTimeoutFirstRetriesWithBackoff(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureMCPTimeout, 3, true, "타임아웃"}
	s := p.DetermineStrategy(c, router.RouteSQL, 0)
	if s.Type != StrategyRetrySame || s.BackoffMs <= 0 {
		t.Fatalf("got %+v", s)
	}
}

func TestRecoveryPolicy_McpTimeoutSecondFallsBackToAlternateRoute(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureMCPTimeout, 3, true, "타임아웃"}
	s := p.DetermineStrategy(c, router.RouteSQL, 1)
	if s.Type != StrategyFallbackRoute {
		t.Fatalf("got %+v", s)
	}
}

func TestRecoveryPolicy_EvidenceConflictProducesPartialResponse(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureEvidenceConflict, 2, true, "증거 충돌"}
	s := p.DetermineStrategy(c, router.RouteVector, 0)
	if s.Type != StrategyPartialResponse {
		t.Fatalf("got %+v", s)
	}
}

func TestRecoveryPolicy_ThreeOrMoreRetriesGivesUp(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureRetrievalEmpty, 2, true, "검색 결과 없음"}
	s := p.DetermineStrategy(c, router.RouteVector, 3)
	if s.Type != StrategyGiveUp {
		t.Fatalf("got %+v", s)
	}
}

func TestRecoveryPolicy_UnrecoverableClassificationGivesUpImmediately(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureSQLSchemaError, 4, false, "권한 부족"}
	s := p.DetermineStrategy(c, router.RouteSQL, 0)
	if s.Type != StrategyGiveUp {
		t.Fatalf("got %+v", s)
	}
}

func TestRecoveryPolicy_SqlFallsBackToVectorThenGraph(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureRouteMiss, 2, true, "미매칭"}
	s := p.DetermineStrategy(c, router.RouteSQL, 0)
	if s.FallbackRoutes[0] != router.RouteVector {
		t.Fatalf("got %+v", s.FallbackRoutes)
	}
}

func TestRecoveryPolicy_VectorFallsBackToGraphThenSql(t *testing.T) {
	p := &RecoveryPolicy{}
	c := FailureClassification{FailureRouteMiss, 2, true, "미매칭"}
	s := p.DetermineStrategy(c, router.RouteVector, 0)
	if s.FallbackRoutes[0] != router.RouteGraph {
		t.Fatalf("got %+v", s.FallbackRoutes)
	}
}
