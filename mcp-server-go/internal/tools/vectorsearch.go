package tools

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"
)

// VectorDoc mirrors a row from the Spring AI PgVectorStore-managed "vector_store" table
// (schema confirmed from spring-ai-pgvector-store 1.0.3 bytecode:
// CREATE TABLE ... (id uuid PRIMARY KEY, content text, metadata json, embedding vector(n))).
type VectorDoc struct {
	Source string
	Score  *float64
	Text   string
}

const vectorSearchDefaultTopK = 4
const vectorSearchMaxTopK = 10
const vectorSearchOverfetchCap = 20

// clampTopK mirrors `(topK ?: 4).coerceIn(1, 10)`.
func clampTopK(topK *int) int {
	k := vectorSearchDefaultTopK
	if topK != nil {
		k = *topK
	}
	if k < 1 {
		k = 1
	}
	if k > vectorSearchMaxTopK {
		k = vectorSearchMaxTopK
	}
	return k
}

// overfetchCount mirrors `(k * 5).coerceAtMost(20)`.
func overfetchCount(k int) int {
	n := k * 5
	if n > vectorSearchOverfetchCap {
		n = vectorSearchOverfetchCap
	}
	return n
}

// VectorSearch ports RetrievalTools.vectorSearch 1:1: overfetch k*5 (capped 20) nearest
// neighbors by cosine distance (score = 1 - distance, similarityThreshold = 0.0 i.e.
// accept-all, matching Spring AI's SearchRequest defaults), then re-rank by
// lexicalCoverage desc, vector score desc, and take k.
func VectorSearch(ctx context.Context, pool *pgxpool.Pool, embedder *OllamaEmbedder, query string, topK *int) ([]map[string]any, error) {
	k := clampTopK(topK)
	limit := overfetchCount(k)

	embedding, err := embedder.Embed(ctx, query)
	if err != nil {
		return nil, err
	}

	// distance-type: COSINE_DISTANCE -> "<=>" operator (spring-ai-pgvector-store 1.0.3
	// PgDistanceType.COSINE_DISTANCE.similaritySearchSqlTemplate).
	sql := "SELECT content, metadata, embedding <=> $1 AS distance FROM vector_store " +
		"WHERE embedding <=> $2 < $3 ORDER BY distance LIMIT $4"
	rows, err := pool.Query(ctx, sql, pgvector.NewVector(toFloat32(embedding)), pgvector.NewVector(toFloat32(embedding)), 1.0, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type candidate struct {
		source   string
		score    float64
		text     string
		coverage float64
	}
	var candidates []candidate
	for rows.Next() {
		var content string
		var metadataRaw []byte
		var distance float64
		if err := rows.Scan(&content, &metadataRaw, &distance); err != nil {
			return nil, err
		}
		source := "unknown"
		if len(metadataRaw) > 0 {
			var meta map[string]any
			if err := json.Unmarshal(metadataRaw, &meta); err == nil {
				if s, ok := meta["source"].(string); ok {
					source = s
				}
			}
		}
		score := 1.0 - distance
		candidates = append(candidates, candidate{
			source:   source,
			score:    score,
			text:     content,
			coverage: LexicalCoverage(query, content),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].coverage != candidates[j].coverage {
			return candidates[i].coverage > candidates[j].coverage
		}
		return candidates[i].score > candidates[j].score
	})

	if len(candidates) > k {
		candidates = candidates[:k]
	}

	out := make([]map[string]any, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, map[string]any{
			"source": c.source,
			"score":  c.score,
			"text":   c.text,
		})
	}
	return out, nil
}

func toFloat32(in []float64) []float32 {
	out := make([]float32, len(in))
	for i, v := range in {
		out[i] = float32(v)
	}
	return out
}
