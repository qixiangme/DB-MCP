package tools

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MaxOutputChars mirrors RetrievalTools.MAX_OUTPUT_CHARS.
const MaxOutputChars = 4000

// Handlers bundles the DB pool, embedder, and encoder used by all three MCP tools,
// mirroring RetrievalTools' constructor-injected dependencies (VectorStore, JdbcTemplate,
// ObjectMapper) plus the OllamaEmbedder that Spring AI's VectorStore hides internally.
type Handlers struct {
	Pool     *pgxpool.Pool
	Embedder *OllamaEmbedder
	Encoder  *ResponseEncoder
	Logger   *slog.Logger
}

// guard mirrors RetrievalTools.guard{}: run block, encode success or classify+encode error,
// and never let an error escape across the MCP boundary.
func (h *Handlers) guard(fn func() (any, error)) string {
	value, err := fn()
	if err != nil {
		return h.Encoder.EncodeError(err)
	}
	encoded, err := h.Encoder.Encode(value, MaxOutputChars)
	if err != nil {
		return h.Encoder.EncodeError(err)
	}
	return encoded
}

// VectorSearchInput mirrors vectorSearch's @ToolParam-annotated parameters.
type VectorSearchInput struct {
	Query string `json:"query" jsonschema:"검색할 자연어 질의"`
	TopK  *int   `json:"topK,omitempty" jsonschema:"가져올 문서 수 (1~10, 기본 4)"`
}

// RunSQLInput mirrors runSql's @ToolParam-annotated parameter.
type RunSQLInput struct {
	SQL string `json:"sql" jsonschema:"실행할 PostgreSQL SELECT 문"`
}

// KgSearchInput mirrors kgSearch's @ToolParam-annotated parameter.
type KgSearchInput struct {
	Query string `json:"query" jsonschema:"관계를 조회할 자연어 질의 또는 엔티티 이름"`
}

func textResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}

// HandleVectorSearch implements the "vector_search" tool.
func (h *Handlers) HandleVectorSearch(ctx context.Context, req *mcp.CallToolRequest, in VectorSearchInput) (*mcp.CallToolResult, any, error) {
	out := h.guard(func() (any, error) {
		return VectorSearch(ctx, h.Pool, h.Embedder, in.Query, in.TopK)
	})
	return textResult(out), nil, nil
}

// HandleRunSQL implements the "run_sql" tool.
func (h *Handlers) HandleRunSQL(ctx context.Context, req *mcp.CallToolRequest, in RunSQLInput) (*mcp.CallToolResult, any, error) {
	out := h.guard(func() (any, error) {
		return RunSQL(ctx, h.Pool, in.SQL)
	})
	return textResult(out), nil, nil
}

// HandleKgSearch implements the "kg_search" tool.
func (h *Handlers) HandleKgSearch(ctx context.Context, req *mcp.CallToolRequest, in KgSearchInput) (*mcp.CallToolResult, any, error) {
	out := h.guard(func() (any, error) {
		return KgSearch(ctx, h.Pool, h.Logger, in.Query)
	})
	return textResult(out), nil, nil
}

// RegisterTools mirrors McpServerApplication's riwonaceTools bean: registers exactly the
// 3 tools the contest requires, matching RetrievalToolsContractTest's expected name set.
func (h *Handlers) RegisterTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "vector_search",
		Description: "사내 기술 문서 저장소에서 질문과 의미적으로 유사한 문서를 벡터 검색한다. " +
			"개념 설명, 기술 소개, 정책·가이드 질문에 사용한다.",
	}, h.HandleVectorSearch)

	mcp.AddTool(server, &mcp.Tool{
		Name: "run_sql",
		Description: "NL2SQL 경로가 만든 읽기 전용 SELECT SQL 한 문장을 검증·실행하고 결과를 JSON으로 반환한다. " +
			"집계·통계·목록 등 정형 데이터 질문에 사용한다. INSERT/UPDATE/DELETE는 거부된다.",
	}, h.HandleRunSQL)

	mcp.AddTool(server, &mcp.Tool{
		Name: "kg_search",
		Description: "온톨로지 기반 지식 그래프에서 엔티티와 관련된 관계(triple)를 조회한다. " +
			"'A와 B의 관계', '무엇을 개발했나' 같은 개체 간 연결 질문에 사용한다.",
	}, h.HandleKgSearch)
}
