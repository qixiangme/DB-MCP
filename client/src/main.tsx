import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  Server,
  Sparkles,
  Target,
  TriangleAlert,
} from "lucide-react";
import "./styles.css";

type Route = "VECTOR" | "SQL" | "GRAPH";
type DatasetKind = "companyx" | "eval";
type ToolKind = "all" | "nl2sql" | "vector_search" | "knowledge_graph" | "VECTOR" | "SQL" | "GRAPH";

type AgentAnswer = {
  answer: string;
  routes: Route[];
  toolCalls: string[];
  contextSources: string[];
  latencyMs: number;
};

type DatasetItem = {
  id: string;
  question: string;
  expectedRoute?: Route;
  expectedTool?: string;
  hint?: string;
  keywords?: string[];
  source: DatasetKind;
};

type RunStatus = "success" | "error";

type RunResult = {
  id: string;
  question: string;
  startedAt: string;
  durationMs: number;
  status: RunStatus;
  expectedRoute?: Route;
  expectedTool?: string;
  keywords?: string[];
  hint?: string;
  response?: AgentAnswer;
  error?: string;
};

type ToolsState = {
  status: "idle" | "loading" | "online" | "offline";
  tools: string[];
  message: string;
};

const presets = [
  { label: "Vector", question: "MCP가 기존 RAG보다 운영 관점에서 좋은 점은 무엇인가?" },
  { label: "NL2SQL", question: "플랫폼팀 직원의 평균 급여는 얼마야?" },
  { label: "Graph", question: "air는 누가 개발했어?" },
  { label: "Mixed", question: "MCP와 pgvector를 함께 쓰면 검색 품질과 장애 지점은 어떻게 달라져?" },
];

const datasetSources = [
  { id: "companyx" as const, label: "Company-X 30문항", url: "/datasets/companyx-questions.json" },
  { id: "eval" as const, label: "Route Eval 12문항", url: "/datasets/eval-set.json" },
];

const initialBatch = presets.map((item) => item.question).join("\n");

function App() {
  const [question, setQuestion] = useState(presets[0].question);
  const [batchText, setBatchText] = useState(initialBatch);
  const [concurrency, setConcurrency] = useState(1);
  const [repeatCount, setRepeatCount] = useState(1);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [active, setActive] = useState(false);
  const [toolsState, setToolsState] = useState<ToolsState>({
    status: "idle",
    tools: [],
    message: "아직 확인하지 않았습니다.",
  });
  const [ingestState, setIngestState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [datasetStatus, setDatasetStatus] = useState("데이터셋 로드 전");
  const [selectedDataset, setSelectedDataset] = useState<DatasetKind | "all">("all");
  const [selectedTool, setSelectedTool] = useState<ToolKind>("all");

  useEffect(() => {
    void loadDatasets();
  }, []);

  const filteredDataset = useMemo(() => {
    return datasetItems.filter((item) => {
      const datasetMatches = selectedDataset === "all" || item.source === selectedDataset;
      const toolMatches =
        selectedTool === "all" ||
        item.expectedTool === selectedTool ||
        item.expectedRoute === selectedTool ||
        routeFromTool(item.expectedTool) === selectedTool;
      return datasetMatches && toolMatches;
    });
  }, [datasetItems, selectedDataset, selectedTool]);

  const stats = useMemo(() => buildStats(runs), [runs]);
  const latest = runs[0];

  async function loadDatasets() {
    setDatasetStatus("데이터셋 로드 중");
    try {
      const loaded = await Promise.all(
        datasetSources.map(async (source) => {
          const res = await fetch(source.url);
          if (!res.ok) throw new Error(`${source.label} HTTP ${res.status}`);
          const data = await res.json();
          return normalizeDataset(source.id, data);
        }),
      );
      const items = loaded.flat();
      setDatasetItems(items);
      setDatasetStatus(`${items.length}개 문항 로드됨`);
      setBatchText(items.map((item) => item.question).join("\n"));
    } catch (error) {
      setDatasetStatus(error instanceof Error ? error.message : "데이터셋 로드 실패");
    }
  }

  async function checkTools() {
    setToolsState({ status: "loading", tools: [], message: "agent-app 연결 확인 중" });
    try {
      const res = await fetch("/api/tools");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const tools = Array.isArray(data.mcpTools) ? data.mcpTools.map(String) : [];
      setToolsState({
        status: "online",
        tools,
        message: tools.length ? `${tools.length}개 MCP 도구 감지` : "서버는 응답했지만 도구 목록이 비어 있습니다.",
      });
    } catch (error) {
      setToolsState({
        status: "offline",
        tools: [],
        message: error instanceof Error ? error.message : "연결 실패",
      });
    }
  }

  async function runIngest() {
    setIngestState("loading");
    try {
      const res = await fetch("/mcp-admin/ingest", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setIngestState("done");
    } catch {
      setIngestState("error");
    }
  }

  async function runSingle() {
    if (!question.trim()) return;
    setActive(true);
    const metadata = datasetItems.find((item) => item.question === question.trim());
    const result = await executeQuestion(question.trim(), metadata);
    setRuns((prev) => [result, ...prev]);
    setActive(false);
  }

  async function runBatch() {
    const metadataByQuestion = new Map(datasetItems.map((item) => [item.question, item]));
    const questions = batchText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => Array.from({ length: repeatCount }, () => line));

    if (!questions.length) return;
    setActive(true);

    const queue = [...questions];
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        const result = await executeQuestion(next, metadataByQuestion.get(next));
        setRuns((prev) => [result, ...prev]);
      }
    });

    await Promise.all(workers);
    setActive(false);
  }

  async function runDataset() {
    if (!filteredDataset.length) return;
    setActive(true);
    const queue = filteredDataset.flatMap((item) => Array.from({ length: repeatCount }, () => item));
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        const result = await executeQuestion(item.question, item);
        setRuns((prev) => [result, ...prev]);
      }
    });
    await Promise.all(workers);
    setActive(false);
  }

  function applyFilteredDatasetToBatch() {
    setBatchText(filteredDataset.map((item) => item.question).join("\n"));
  }

  function exportCsv() {
    const header = [
      "startedAt",
      "status",
      "question",
      "expectedRoute",
      "routeHit",
      "keywordHit",
      "latencyMs",
      "clientDurationMs",
      "routes",
      "toolCalls",
      "contextSources",
      "error",
    ];
    const rows = runs.map((run) => {
      const routeHit = isRouteHit(run);
      const keywordHit = isKeywordHit(run);
      return [
        run.startedAt,
        run.status,
        run.question,
        run.expectedRoute ?? "",
        routeHit === undefined ? "" : routeHit ? "Y" : "N",
        keywordHit === undefined ? "" : keywordHit ? "Y" : "N",
        run.response?.latencyMs ?? "",
        run.durationMs,
        run.response?.routes.join("|") ?? "",
        run.response?.toolCalls.join("|") ?? "",
        run.response?.contextSources.join("|") ?? "",
        run.error ?? "",
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `riwonace-mcp-runs-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell" data-testid="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Riwonace MCP Evaluation Client</p>
          <h1 data-testid="page-title">MCP 기반 지능형 데이터 플랫폼 검증 콘솔</h1>
        </div>
        <div className={`status-pill ${toolsState.status}`}>
          {toolsState.status === "online" ? <CheckCircle2 size={18} /> : <Server size={18} />}
          <span>{toolsState.message}</span>
        </div>
      </section>

      <section className="grid metrics-grid" data-testid="metrics-grid">
        <Metric icon={<Activity />} label="성공률" value={`${stats.successRate}%`} detail={`${stats.success}/${stats.total} 성공`} />
        <Metric icon={<BarChart3 />} label="평균 지연" value={`${stats.averageLatency}ms`} detail={`P95 ${stats.p95Latency}ms`} />
        <Metric icon={<Target />} label="라우트 적중" value={`${stats.routeHitRate}%`} detail={`${stats.routeHits}/${stats.routeEvaluated} 평가`} />
        <Metric icon={<ClipboardList />} label="키워드 적중" value={`${stats.keywordHitRate}%`} detail={`${stats.keywordHits}/${stats.keywordEvaluated} 평가`} />
      </section>

      <section className="workspace">
        <div className="panel query-panel" data-testid="single-query-panel">
          <div className="panel-header">
            <div>
              <h2>단일 질의</h2>
              <p>질문 하나를 실행하고 라우팅, 도구, 출처, 지연 시간을 즉시 확인합니다.</p>
            </div>
            <button className="icon-button" data-testid="tools-icon-button" onClick={checkTools} title="MCP 도구 확인">
              <RefreshCcw size={18} />
            </button>
          </div>

          <div className="preset-row">
            {presets.map((preset) => (
              <button key={preset.label} className="preset-button" onClick={() => setQuestion(preset.question)}>
                {preset.label}
              </button>
            ))}
          </div>

          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5} />

          <div className="button-row">
            <button className="primary-button" data-testid="run-single-button" disabled={active || !question.trim()} onClick={runSingle}>
              {active ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              실행
            </button>
            <button className="secondary-button" data-testid="check-tools-button" disabled={toolsState.status === "loading"} onClick={checkTools}>
              <Server size={18} />
              상태 확인
            </button>
            <button className="secondary-button" data-testid="ingest-button" disabled={ingestState === "loading"} onClick={runIngest}>
              <Database size={18} />
              샘플 적재
            </button>
          </div>

          {ingestState === "done" && <p className="inline-ok">샘플 데이터 적재 요청이 완료되었습니다.</p>}
          {ingestState === "error" && <p className="inline-error">mcp-server 8081 연결 또는 적재 요청을 확인하세요.</p>}
        </div>

        <div className="panel batch-panel" data-testid="batch-panel">
          <div className="panel-header">
            <div>
              <h2>데이터셋 성능 테스트</h2>
              <p>루트 테스트 데이터셋을 불러와 라우트 적중률과 키워드 적중률을 함께 확인합니다.</p>
            </div>
          </div>

          <div className="dataset-toolbar" data-testid="dataset-toolbar">
            <label>
              데이터셋
              <select value={selectedDataset} onChange={(event) => setSelectedDataset(event.target.value as DatasetKind | "all")}>
                <option value="all">전체</option>
                <option value="companyx">Company-X 30문항</option>
                <option value="eval">Route Eval 12문항</option>
              </select>
            </label>
            <label>
              도구/라우트
              <select value={selectedTool} onChange={(event) => setSelectedTool(event.target.value as ToolKind)}>
                <option value="all">전체</option>
                <option value="nl2sql">NL2SQL</option>
                <option value="vector_search">Vector Search</option>
                <option value="knowledge_graph">Knowledge Graph</option>
                <option value="SQL">SQL Route</option>
                <option value="VECTOR">Vector Route</option>
                <option value="GRAPH">Graph Route</option>
              </select>
            </label>
          </div>

          <div className="dataset-summary">
            <span>{datasetStatus}</span>
            <strong>{filteredDataset.length}개 선택됨</strong>
          </div>

          <textarea value={batchText} onChange={(event) => setBatchText(event.target.value)} rows={7} />

          <div className="control-grid">
            <label>
              동시성
              <input type="number" min={1} max={8} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
            </label>
            <label>
              반복
              <input type="number" min={1} max={10} value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} />
            </label>
          </div>

          <div className="button-row">
            <button className="secondary-button" data-testid="apply-dataset-button" disabled={!filteredDataset.length} onClick={applyFilteredDatasetToBatch}>
              <ClipboardList size={18} />
              선택 문항 채우기
            </button>
            <button className="primary-button" data-testid="run-dataset-button" disabled={active || !filteredDataset.length} onClick={runDataset}>
              {active ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              데이터셋 실행
            </button>
            <button className="primary-button" data-testid="run-batch-button" disabled={active} onClick={runBatch}>
              {active ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              텍스트 실행
            </button>
            <button className="secondary-button" data-testid="export-csv-button" disabled={!runs.length} onClick={exportCsv}>
              <Download size={18} />
              CSV
            </button>
          </div>
        </div>
      </section>

      <section className="dataset-preview">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>선택된 데이터셋 문항</h2>
              <p>문항을 누르면 단일 질의 입력창에 복사됩니다.</p>
            </div>
          </div>
          <div className="dataset-list" data-testid="dataset-list">
            {filteredDataset.slice(0, 12).map((item) => (
              <button key={item.id} className="dataset-item" onClick={() => setQuestion(item.question)}>
                <span>{item.id}</span>
                <strong>{item.expectedRoute ?? routeFromTool(item.expectedTool) ?? item.expectedTool ?? "N/A"}</strong>
                <em>{item.question}</em>
              </button>
            ))}
            {!filteredDataset.length && <p className="muted">선택된 문항이 없습니다.</p>}
          </div>
        </div>
      </section>

      <section className="results-layout">
        <div className="panel answer-panel" data-testid="answer-panel">
          <div className="panel-header">
            <div>
              <h2>최근 응답</h2>
              <p>모델 답변과 근거 구성을 함께 봅니다.</p>
            </div>
          </div>
          {latest ? <AnswerView run={latest} /> : <EmptyState />}
        </div>

        <div className="panel runs-panel" data-testid="runs-panel">
          <div className="panel-header">
            <div>
              <h2>실행 이력</h2>
              <p>실패 항목과 병목 질문을 빠르게 추적합니다.</p>
            </div>
          </div>
          <div className="run-list">
            {runs.map((run) => (
              <button key={run.id} className={`run-item ${run.status}`} onClick={() => setQuestion(run.question)}>
                <span className="run-question">{run.question}</span>
                <span className="run-meta">
                  {run.expectedRoute && (isRouteHit(run) ? "route OK · " : "route NG · ")}
                  {run.status === "success" ? `${run.response?.latencyMs ?? run.durationMs}ms` : "실패"}
                </span>
              </button>
            ))}
            {!runs.length && <p className="muted">아직 실행 결과가 없습니다.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function AnswerView({ run }: { run: RunResult }) {
  if (run.status === "error") {
    return (
      <div className="error-box">
        <TriangleAlert size={20} />
        <div>
          <strong>요청 실패</strong>
          <p>{run.error}</p>
        </div>
      </div>
    );
  }

  const response = run.response;
  if (!response) return null;
  const routeHit = isRouteHit(run);
  const keywordHit = isKeywordHit(run);

  return (
    <div className="answer-view">
      <div className="grading-box" data-testid="grading-box">
        <div>
          <span>라우트 정답</span>
          <strong>
            {run.expectedRoute ? `${run.expectedRoute} · ${routeHit ? "정답" : "오답"}` : "정답 기준 없음"}
          </strong>
        </div>
        <div>
          <span>내용 정답</span>
          <strong>
            {run.keywords?.length
              ? `${keywordHit ? "키워드 적중" : "키워드 미적중"} · ${run.keywords.join(", ")}`
              : "키워드/정답값 없음"}
          </strong>
        </div>
        {run.hint && (
          <div className="grading-hint">
            <span>기준 힌트</span>
            <strong>{run.hint}</strong>
          </div>
        )}
      </div>
      <div className="answer-body">{response.answer || "응답 본문이 비어 있습니다."}</div>
      <div className="tag-group">
        {run.expectedRoute && <span className={`tag ${routeHit ? "ok" : "bad"}`}>expected {run.expectedRoute}</span>}
        {keywordHit !== undefined && <span className={`tag ${keywordHit ? "ok" : "bad"}`}>keyword {keywordHit ? "hit" : "miss"}</span>}
        {response.routes.map((route) => (
          <span key={route} className="tag route">
            {route}
          </span>
        ))}
        {response.toolCalls.map((tool, index) => (
          <span key={`${tool}-${index}`} className="tag tool">
            {tool}
          </span>
        ))}
      </div>
      <div className="source-list">
        <h3>Context Sources</h3>
        {response.contextSources.length ? (
          response.contextSources.map((source, index) => <span key={`${source}-${index}`}>{source}</span>)
        ) : (
          <span>출처 없음</span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <Sparkles size={28} />
      <p>질문을 실행하면 답변, 라우트, 도구 호출, 컨텍스트 출처가 여기에 표시됩니다.</p>
    </div>
  );
}

async function executeQuestion(question: string, metadata?: DatasetItem): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const durationMs = Math.round(performance.now() - start);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const response = (await res.json()) as AgentAnswer;
    return {
      id: crypto.randomUUID(),
      question,
      startedAt,
      durationMs,
      status: "success",
      expectedRoute: metadata?.expectedRoute ?? routeFromTool(metadata?.expectedTool),
      expectedTool: metadata?.expectedTool,
      keywords: metadata?.keywords,
      hint: metadata?.hint,
      response,
    };
  } catch (error) {
    return {
      id: crypto.randomUUID(),
      question,
      startedAt,
      durationMs: Math.round(performance.now() - start),
      status: "error",
      expectedRoute: metadata?.expectedRoute ?? routeFromTool(metadata?.expectedTool),
      expectedTool: metadata?.expectedTool,
      keywords: metadata?.keywords,
      hint: metadata?.hint,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function normalizeDataset(source: DatasetKind, data: unknown): DatasetItem[] {
  if (source === "companyx" && Array.isArray(data)) {
    return data.map((item: any, index) => ({
      id: `CX-${String(index + 1).padStart(2, "0")}`,
      question: String(item.q ?? item.question ?? ""),
      expectedTool: String(item.tool ?? ""),
      expectedRoute: routeFromTool(String(item.tool ?? "")),
      hint: item.hint ? String(item.hint) : undefined,
      source,
    }));
  }

  const questions = (data as any)?.questions;
  if (source === "eval" && Array.isArray(questions)) {
    return questions.map((item: any, index) => ({
      id: String(item.id ?? `EV-${String(index + 1).padStart(2, "0")}`),
      question: String(item.question ?? item.q ?? ""),
      expectedRoute: normalizeRoute(item.expectedRoute),
      keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : undefined,
      source,
    }));
  }

  return [];
}

function normalizeRoute(value: unknown): Route | undefined {
  const route = String(value ?? "").toUpperCase();
  return route === "VECTOR" || route === "SQL" || route === "GRAPH" ? route : undefined;
}

function routeFromTool(tool?: string): Route | undefined {
  if (!tool) return undefined;
  if (tool === "nl2sql") return "SQL";
  if (tool === "vector_search") return "VECTOR";
  if (tool === "knowledge_graph") return "GRAPH";
  return normalizeRoute(tool);
}

function isRouteHit(run: RunResult): boolean | undefined {
  if (!run.expectedRoute || run.status !== "success") return undefined;
  return run.response?.routes.includes(run.expectedRoute) ?? false;
}

function isKeywordHit(run: RunResult): boolean | undefined {
  if (!run.keywords?.length || run.status !== "success") return undefined;
  const answer = run.response?.answer ?? "";
  return run.keywords.some((keyword) => answer.includes(keyword));
}

function buildStats(runs: RunResult[]) {
  const total = runs.length;
  const successful = runs.filter((run) => run.status === "success" && run.response);
  const latencies = successful.map((run) => run.response?.latencyMs ?? run.durationMs).sort((a, b) => a - b);
  const averageLatency = latencies.length ? Math.round(latencies.reduce((sum, item) => sum + item, 0) / latencies.length) : 0;
  const p95Latency = latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] : 0;
  const routeEvaluated = runs.filter((run) => isRouteHit(run) !== undefined);
  const keywordEvaluated = runs.filter((run) => isKeywordHit(run) !== undefined);
  const routeHits = routeEvaluated.filter((run) => isRouteHit(run)).length;
  const keywordHits = keywordEvaluated.filter((run) => isKeywordHit(run)).length;

  return {
    total,
    success: successful.length,
    successRate: total ? Math.round((successful.length / total) * 100) : 0,
    averageLatency,
    p95Latency,
    routeEvaluated: routeEvaluated.length,
    routeHits,
    routeHitRate: routeEvaluated.length ? Math.round((routeHits / routeEvaluated.length) * 100) : 0,
    keywordEvaluated: keywordEvaluated.length,
    keywordHits,
    keywordHitRate: keywordEvaluated.length ? Math.round((keywordHits / keywordEvaluated.length) * 100) : 0,
  };
}

createRoot(document.getElementById("root")!).render(<App />);
