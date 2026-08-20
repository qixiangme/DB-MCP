package resources

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// SchemaURI mirrors SchemaResourceConfiguration.SCHEMA_URI.
const SchemaURI = "db://schema"

// Encoder is the minimal interface Handler needs from tools.ResponseEncoder, avoiding an
// import cycle between internal/resources and internal/tools (both depend on the same
// encode/truncate/error-classify contract from ToolResponseEncoder.kt).
type Encoder interface {
	Encode(value any, outputLimit int) (string, error)
	EncodeError(err error) string
}

// Handler serves the "db://schema" MCP Resource, mirroring JdbcSchemaCatalog + the
// SchemaResourceConfiguration bean that registers it.
type Handler struct {
	Pool    *pgxpool.Pool
	Encoder Encoder
}

func (h *Handler) readJSON(ctx context.Context) string {
	snapshot, err := BuildSchemaSnapshot(ctx, h.Pool)
	if err != nil {
		return h.Encoder.EncodeError(err)
	}
	encoded, err := h.Encoder.Encode(snapshot, MaxSchemaOutputChars)
	if err != nil {
		return h.Encoder.EncodeError(err)
	}
	return encoded
}

// Register mirrors SchemaResourceConfiguration.databaseSchemaResource: registers a single
// SyncResourceSpecification-equivalent resource at db://schema, mimeType application/json.
func (h *Handler) Register(server *mcp.Server) {
	server.AddResource(&mcp.Resource{
		URI:         SchemaURI,
		Name:        "database-schema",
		Description: "NL2SQL 생성에 필요한 테이블·컬럼·외래키·저카디널리티 값 힌트",
		MIMEType:    "application/json",
	}, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{
				{URI: req.Params.URI, MIMEType: "application/json", Text: h.readJSON(ctx)},
			},
		}, nil
	})
}
