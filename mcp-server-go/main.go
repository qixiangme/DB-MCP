// Command mcp-server-go is a 1:1 port of mcp-server (Kotlin/Spring AI) to
// Go + the official MCP SDK. It exposes the same 3 MCP tools (vector_search, run_sql,
// kg_search) and the same "db://schema" MCP Resource, against the same PostgreSQL
// schema and Ollama embedding model, on the same default port (8081).
//
// Architecture, routing, SQL handling, and caching policy are ported unchanged from
// the Kotlin baseline in mcp-server/src/main/kotlin/com/riwonace/mcp — see
// internal/tools and internal/resources for the per-component mapping.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/riwonace/mcp-server-go/internal/resources"
	"github.com/riwonace/mcp-server-go/internal/tools"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	port := getenv("SERVER_PORT", "8081")
	dbURL := getenv("DATABASE_URL", "postgres://riwonace:riwonace@localhost:5433/riwonace")
	ollamaBaseURL := getenv("OLLAMA_BASE_URL", "http://localhost:11434")
	embeddingModel := getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		logger.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	embedder := &tools.OllamaEmbedder{BaseURL: ollamaBaseURL, Model: embeddingModel}
	encoder := tools.NewResponseEncoder(tools.MaxOutputChars, logger)

	handlers := &tools.Handlers{
		Pool:     pool,
		Embedder: embedder,
		Encoder:  encoder,
		Logger:   logger,
	}

	// spring.ai.mcp.server.name / version mirrored from mcp-server/application.yml.
	mcpServer := mcp.NewServer(&mcp.Implementation{
		Name:    "riwonace-data-platform",
		Version: "1.0.0",
	}, nil)

	handlers.RegisterTools(mcpServer)

	schemaHandler := &resources.Handler{Pool: pool, Encoder: encoder}
	schemaHandler.Register(mcpServer)

	// spring.ai.mcp.server.type: SYNC in the baseline maps to the SSE transport here;
	// both are single-session-at-a-time request/response over a long-lived connection.
	sseHandler := mcp.NewSSEHandler(func(*http.Request) *mcp.Server { return mcpServer }, nil)

	logger.Info("mcp-server-go listening", "port", port)
	if err := http.ListenAndServe(":"+port, sseHandler); err != nil {
		logger.Error("server exited", "error", err)
		os.Exit(1)
	}
}
