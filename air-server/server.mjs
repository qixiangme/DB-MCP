// air 프레임워크로 구현한 MCP 데이터 플랫폼 서버 (Kotlin mcp-server와 동일한 도구 4종).
// MCP 표준 규격 덕분에 agent-app은 접속 URL만 바꾸면 이 서버로 그대로 붙는다
// — "L3 프로토콜 계층의 구현체 교체 가능성" 실증.
import { defineServer, defineTool, cachePlugin, timeoutPlugin } from '@airmcp-dev/core';
import pg from 'pg';
import { pathToFileURL } from 'node:url';

const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5433),
  database: process.env.PGDATABASE ?? 'riwonace',
  user: process.env.PGUSER ?? 'riwonace',
  password: process.env.PGPASSWORD ?? 'riwonace',
  // Spring Boot(HikariCP)의 기본 풀 크기와 맞춰 서버 프레임워크 비교 시 풀 크기를 통제한다.
  max: Number(process.env.PGPOOL_MAX ?? 10),
});

const OLLAMA = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text';
const VECTOR_SEARCH_MODE = process.env.VECTOR_SEARCH_MODE ?? 'exact';
const MAX_OUTPUT_CHARS = 4000;
const MAX_HINT_VALUES = 12;

/** 모든 도구 공통 방어막: 예외를 오류 JSON으로, 출력 크기 제한 (Kotlin guard()와 동일 정책) */
const guard = async (fn) => {
  try {
    const json = JSON.stringify(await fn());
    return json.length > MAX_OUTPUT_CHARS ? json.slice(0, MAX_OUTPUT_CHARS) + '"...(truncated)"' : json;
  } catch (e) {
    return JSON.stringify({ error: e.message ?? String(e) });
  }
};

/** 제로 트러스트 SQL 검증 (Kotlin SqlGuard 포팅) */
export const sqlGuard = (sql) => {
  const s = sql.trim().replace(/;+\s*$/, '');
  const upper = s.toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) throw new Error('SELECT/WITH 문만 허용됩니다.');
  if (s.includes(';')) throw new Error('다중 문장은 허용되지 않습니다.');
  if (s.includes('--') || s.includes('/*')) throw new Error('주석은 허용되지 않습니다.');
  for (const kw of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE', 'PG_SLEEP']) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(s)) throw new Error(`${kw}는 허용되지 않습니다. SELECT만 가능합니다.`);
  }
  return /\bLIMIT\b/i.test(s) ? s : `${s} LIMIT 50`;
};

const embed = async (text) => {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`임베딩 실패: HTTP ${res.status}`);
  return (await res.json()).embedding;
};

export const queryTokens = (query) => {
  const stop = new Set(['어떻게', '무엇', '되어', '있어', '있었', '있는', '해줘', '알려줘', '궁금해', '보여줘', '관련', '내용', '방법', '어디', '누구']);
  return [...new Set(query
    .split(/[\s,.?!'"()]+/)
    .map((token) => token.replace(/(은|는|이|가|을|를|의|에서|으로|로|와|과|도|만|야|이야)$/, ''))
    .filter((token) => token.length >= 2 && !stop.has(token)))]
    .slice(0, 6);
};

const server = defineServer({
  name: 'riwonace-data-platform-air',
  version: '1.0.0',
  transport: { type: 'sse', port: Number(process.env.PORT ?? 8082) },
  use: [
    // Spring AI MCP client의 request-timeout(120s)과 동일하게 맞춘다.
    // PERF: 단계별 지연 계측 후 도구별 timeout으로 좁히는 것은 별도 벤치마크에서 검증한다.
    timeoutPlugin({ timeoutMs: Number(process.env.MCP_TOOL_TIMEOUT_MS ?? 120_000) }),
    cachePlugin({ ttlMs: 60_000, tools: ['get_schema'] }),
  ],
  tools: [
    defineTool('vector_search', {
      description:
        '사내 기술 문서 저장소에서 질문과 의미적으로 유사한 문서를 벡터 검색한다. ' +
        '개념 설명, 기술 소개, 정책·가이드 질문에 사용한다.',
      params: { query: 'string', topK: 'number?' },
      handler: ({ query, topK }) =>
        guard(async () => {
          const k = Math.min(Math.max(topK ?? 4, 1), 10);
          const vec = `[${(await embed(query)).join(',')}]`;
          const { rows: vRows } = await pool.query(
            `SELECT metadata->>'source' AS source, content AS text,
                    1 - (embedding <=> $1::vector) AS score
             FROM vector_store ORDER BY embedding <=> $1::vector LIMIT 10`,
            [vec],
          );

          // Spring AI 기준선은 pgvector exact cosine 검색이다. AIR의 기본 모드도 같은 SQL과
          // top-k를 사용해야 프레임워크 외 변수를 통제한 비교가 된다.
          if (VECTOR_SEARCH_MODE === 'exact') {
            return vRows.slice(0, k).map((row) => ({
              source: row.source ?? 'unknown',
              score: Number(row.score),
              text: row.text,
            }));
          }
          if (VECTOR_SEARCH_MODE !== 'hybrid') {
            throw new Error(`지원하지 않는 VECTOR_SEARCH_MODE: ${VECTOR_SEARCH_MODE}`);
          }

          // 선택형 성능 후보: 한국어 임베딩 리콜을 키워드 검색과 RRF로 보완한다.
          // exact 기준선과 섞지 말고 VECTOR_SEARCH_MODE=hybrid로 별도 측정한다.
          const tokens = queryTokens(query);
          let kRows = [];
          if (tokens.length > 0) {
            // 매칭된 토큰 수로 정렬 — 흔한 단어 하나만 걸린 문서가 앞서지 않게 한다
            const hits = tokens.map((_, i) => `(CASE WHEN content ILIKE $${i + 1} THEN 1 ELSE 0 END)`).join(' + ');
            const where = tokens.map((_, i) => `content ILIKE $${i + 1}`).join(' OR ');
            kRows = (
              await pool.query(
                `SELECT metadata->>'source' AS source, content AS text, 0 AS score, ${hits} AS hits
                 FROM vector_store WHERE ${where} ORDER BY hits DESC LIMIT 10`,
                tokens.map((t) => `%${t}%`),
              )
            ).rows;
          }
          // Reciprocal Rank Fusion: 두 랭킹의 1/(60+순위) 합산
          const fused = new Map();
          const addRank = (rows, weight) =>
            rows.forEach((r, i) => {
              const key = r.text.slice(0, 80);
              const cur = fused.get(key) ?? { ...r, rrf: 0 };
              cur.rrf += weight / (60 + i);
              fused.set(key, cur);
            });
          addRank(vRows, 1.0);
          addRank(kRows, 1.0);
          return [...fused.values()]
            .sort((a, b) => b.rrf - a.rrf)
            .slice(0, k)
            .map((r) => ({ source: r.source ?? 'unknown', score: Number(r.score), text: r.text }));
        }),
    }),

    defineTool('get_schema', {
      description:
        '관계형 데이터베이스의 테이블·컬럼 스키마와 카테고리형 컬럼의 실제 값 목록을 조회한다. ' +
        'SQL을 작성하기 전에 반드시 호출한다.',
      params: {},
      handler: () =>
        guard(async () => {
          const { rows } = await pool.query(
            `SELECT table_name, column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name NOT IN ('vector_store', 'kg_triples', 'document_chunks')
             ORDER BY table_name, ordinal_position`,
          );
          const tables = {};
          for (const r of rows) (tables[r.table_name] ??= []).push(`${r.column_name} (${r.data_type})`);
          const valueHints = {};
          for (const r of rows.filter((r) => r.data_type.includes('char'))) {
            const { rows: vals } = await pool.query(
              `SELECT DISTINCT ${r.column_name} AS v FROM ${r.table_name}
               WHERE ${r.column_name} IS NOT NULL LIMIT ${MAX_HINT_VALUES + 1}`,
            );
            if (vals.length >= 1 && vals.length <= MAX_HINT_VALUES)
              valueHints[`${r.table_name}.${r.column_name}`] = vals.map((x) => x.v);
          }
          return { tables, valueHints };
        }),
    }),

    defineTool('run_sql', {
      description:
        '읽기 전용 SELECT SQL 한 문장을 실행하고 결과를 JSON으로 반환한다. ' +
        '집계·통계·목록 등 정형 데이터 질문에 사용한다. INSERT/UPDATE/DELETE는 거부된다.',
      params: { sql: 'string' },
      handler: ({ sql }) =>
        guard(async () => {
          const safe = sqlGuard(sql);
          const { rows } = await pool.query(safe);
          return { executedSql: safe, rows };
        }),
    }),

    defineTool('kg_search', {
      description:
        '온톨로지 기반 지식 그래프에서 엔티티와 관련된 관계(triple)를 조회한다. ' +
        "'A와 B의 관계', '무엇을 개발했나' 같은 개체 간 연결 질문에 사용한다.",
      params: { query: 'string' },
      handler: ({ query }) =>
        guard(async () => {
          const tokens = [...new Set(query.split(/[\s,.?!'"()]+/).map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
          if (tokens.length === 0) return [];
          const where = tokens
            .map((_, i) => {
              const b = i * 4;
              return `subject ILIKE $${b + 1} OR object ILIKE $${b + 2} OR $${b + 3} ILIKE '%' || subject || '%' OR $${b + 4} ILIKE '%' || object || '%'`;
            })
            .join(' OR ');
          const params = tokens.flatMap((t) => [`%${t}%`, `%${t}%`, t, t]);
          const { rows: direct } = await pool.query(
            `SELECT subject, predicate, object FROM kg_triples WHERE ${where} LIMIT 30`,
            params,
          );
          const entities = [...new Set(direct.flatMap((r) => [r.subject, r.object]))];
          let neighbors = [];
          if (entities.length > 0) {
            const inClause = entities.map((_, i) => `$${i + 1}`).join(',');
            const inClause2 = entities.map((_, i) => `$${entities.length + i + 1}`).join(',');
            neighbors = (
              await pool.query(
                `SELECT subject, predicate, object FROM kg_triples
                 WHERE subject IN (${inClause}) OR object IN (${inClause2}) LIMIT 30`,
                [...entities, ...entities],
              )
            ).rows;
          }
          const seen = new Set();
          return [...direct, ...neighbors]
            .filter((r) => {
              const key = `${r.subject}|${r.predicate}|${r.object}`;
              return seen.has(key) ? false : seen.add(key);
            })
            .slice(0, 40)
            .map((r) => `${r.subject} --[${r.predicate}]--> ${r.object}`);
        }),
    }),
  ],
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.start();
  console.log(
    `air MCP server on :${process.env.PORT ?? 8082} ` +
      `(vector=${VECTOR_SEARCH_MODE}; tools: vector_search, run_sql, kg_search, get_schema)`,
  );
}
