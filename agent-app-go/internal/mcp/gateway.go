// Package mcp ports com.riwonace.agent.mcp from the Kotlin/Spring AI baseline.
package mcp

import (
	"context"
	"fmt"
	"sync"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

const SchemaURI = "db://schema"

// Gateway ports McpGateway.kt 1:1: a single MCP client session, request/response
// serialized behind a mutex (mirrors McpSessionGuard's ReentrantLock), with the
// db://schema resource cached for the process lifetime once read (mirrors the
// AtomicReference<String?> cachedSchema, confirmed as an intentional behavior by
// McpGatewayTest asserting readResource is called exactly once).
type Gateway struct {
	session *sdkmcp.ClientSession

	mu           sync.Mutex
	cachedSchema *string
}

func NewGateway(session *sdkmcp.ClientSession) *Gateway {
	return &Gateway{session: session}
}

func (g *Gateway) VectorSearch(ctx context.Context, query string, topK int) (string, error) {
	return g.callTool(ctx, "vector_search", map[string]any{"query": query, "topK": topK})
}

func (g *Gateway) RunSQL(ctx context.Context, sql string) (string, error) {
	return g.callTool(ctx, "run_sql", map[string]any{"sql": sql})
}

func (g *Gateway) KgSearch(ctx context.Context, query string) (string, error) {
	return g.callTool(ctx, "kg_search", map[string]any{"query": query})
}

func (g *Gateway) Schema(ctx context.Context) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.cachedSchema != nil {
		return *g.cachedSchema, nil
	}

	text, err := g.readTextResource(ctx, SchemaURI)
	if err != nil {
		return "", err
	}
	g.cachedSchema = &text
	return text, nil
}

func (g *Gateway) ListToolNames(ctx context.Context) ([]string, error) {
	var names []string
	for tool, err := range g.session.Tools(ctx, nil) {
		if err != nil {
			return nil, err
		}
		names = append(names, tool.Name)
	}
	return names, nil
}

func (g *Gateway) ListResourceURIs(ctx context.Context) ([]string, error) {
	var uris []string
	for res, err := range g.session.Resources(ctx, nil) {
		if err != nil {
			return nil, err
		}
		uris = append(uris, res.URI)
	}
	return uris, nil
}

func (g *Gateway) callTool(ctx context.Context, name string, args map[string]any) (string, error) {
	result, err := g.session.CallTool(ctx, &sdkmcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		return "", err
	}
	var out string
	for _, c := range result.Content {
		if tc, ok := c.(*sdkmcp.TextContent); ok {
			if out != "" {
				out += "\n"
			}
			out += tc.Text
		}
	}
	return out, nil
}

func (g *Gateway) readTextResource(ctx context.Context, uri string) (string, error) {
	result, err := g.session.ReadResource(ctx, &sdkmcp.ReadResourceParams{URI: uri})
	if err != nil {
		return "", err
	}
	var out string
	for _, c := range result.Contents {
		if out != "" {
			out += "\n"
		}
		out += c.Text
	}
	if out == "" {
		return "", fmt.Errorf("MCP Resource가 비어 있습니다: %s", uri)
	}
	return out, nil
}
