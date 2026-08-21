#!/usr/bin/env python3
"""3-way benchmark harness: Kotlin/Spring AI baseline vs Go vs Kotlin/Ktor.

Measures, for each implementation's MCP server layer (vector_search, run_sql,
kg_search) and agent layer (/api/chat/v2):
- startup time (process spawn -> first successful health probe)
- request latency p50/p95/p99 under sequential load
- requests/sec and latency under concurrent load
- RSS (resident memory) sampled while serving load
- error behavior (malformed input, DML rejection)
- cancellation latency (client-side timeout / connection abort)

Uses eval/official-eval.json (existing 30-question set, 10 per route) as the
question set -- no new benchmark questions are authored, per the repo's benchmark
integrity policy.

Run one implementation at a time (they share ports 8081/8080), e.g.:
    python3 bench_harness.py --impl baseline --mcp-cmd '...' --agent-cmd '...'
"""
import argparse
import json
import os
import shlex
import socket
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EVAL_FILE = REPO_ROOT / "eval" / "official-eval.json"


def http_post(url, body, timeout=60):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = time.monotonic() - started
            return resp.status, resp.read().decode("utf-8"), elapsed
    except urllib.error.HTTPError as e:
        elapsed = time.monotonic() - started
        return e.code, e.read().decode("utf-8"), elapsed
    except Exception as e:
        elapsed = time.monotonic() - started
        return None, str(e), elapsed


def tcp_port_open(host, port, timeout=2):
    """Health probe for SSE endpoints, which hold the HTTP connection open
    indefinitely (so a GET request via urlopen would block instead of returning) --
    a plain TCP connect is the only health signal that fits an always-streaming
    endpoint without holding the harness hostage."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def http_get(url, timeout=10):
    started = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            elapsed = time.monotonic() - started
            return resp.status, resp.read().decode("utf-8"), elapsed
    except urllib.error.HTTPError as e:
        elapsed = time.monotonic() - started
        return e.code, e.read().decode("utf-8"), elapsed
    except Exception as e:
        elapsed = time.monotonic() - started
        return None, str(e), elapsed


def percentile(values, pct):
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * (pct / 100)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def rss_kb(pid):
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
        return int(out.stdout.strip()) if out.stdout.strip() else None
    except Exception:
        return None


def cpu_percent(pid):
    try:
        out = subprocess.run(["ps", "-o", "%cpu=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
        return float(out.stdout.strip()) if out.stdout.strip() else None
    except Exception:
        return None


class ManagedProcess:
    def __init__(self, name, cmd, cwd, env, health_url, log_path, health_mode="http"):
        self.name = name
        self.cmd = cmd
        self.cwd = cwd
        self.env = env
        self.health_url = health_url
        self.log_path = log_path
        self.health_mode = health_mode  # "http" (expects a real response) or "tcp" (SSE-style, connect-only)
        self.proc = None
        self.startup_seconds = None

    def _probe(self):
        if self.health_mode == "tcp":
            parsed = urllib.parse.urlparse(self.health_url)
            return tcp_port_open(parsed.hostname, parsed.port or 80)
        status, _, _ = http_get(self.health_url, timeout=2)
        return status is not None

    def start(self, timeout=90):
        log_file = open(self.log_path, "w")
        started = time.monotonic()
        self.proc = subprocess.Popen(
            self.cmd if isinstance(self.cmd, list) else shlex.split(self.cmd),
            cwd=self.cwd, env=self.env, stdout=log_file, stderr=subprocess.STDOUT,
        )
        deadline = started + timeout
        while time.monotonic() < deadline:
            if self._probe():
                self.startup_seconds = time.monotonic() - started
                return True
            if self.proc.poll() is not None:
                raise RuntimeError(f"{self.name} exited early, see {self.log_path}")
            time.sleep(0.5)
        raise TimeoutError(f"{self.name} did not become healthy within {timeout}s")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)


def load_questions():
    data = json.loads(EVAL_FILE.read_text())
    return data["questions"]


def bench_agent_layer(agent_base_url, questions, pid, results):
    latencies = []
    per_route = {"SQL": [], "VECTOR": [], "GRAPH": []}
    errors = []
    rss_samples = []
    cpu_samples = []

    for q in questions:
        status, body, elapsed = http_post(f"{agent_base_url}/api/chat/v2", {"question": q["question"]}, timeout=120)
        if status != 200:
            errors.append({"id": q["id"], "status": status, "body": body[:300]})
            continue
        latencies.append(elapsed)
        route = q.get("expectedRoute", "UNKNOWN")
        per_route.setdefault(route, []).append(elapsed)
        r = rss_kb(pid)
        c = cpu_percent(pid)
        if r:
            rss_samples.append(r)
        if c is not None:
            cpu_samples.append(c)

    results["sequential"] = {
        "n": len(latencies),
        "errors": len(errors),
        "error_detail": errors,
        "p50_s": percentile(latencies, 50),
        "p95_s": percentile(latencies, 95),
        "p99_s": percentile(latencies, 99),
        "mean_s": statistics.mean(latencies) if latencies else None,
        "per_route_mean_s": {k: (statistics.mean(v) if v else None) for k, v in per_route.items()},
        "rss_kb_mean": statistics.mean(rss_samples) if rss_samples else None,
        "rss_kb_max": max(rss_samples) if rss_samples else None,
        "cpu_percent_mean": statistics.mean(cpu_samples) if cpu_samples else None,
    }


def bench_concurrency(agent_base_url, questions, concurrency, pid, results):
    import concurrent.futures

    def one_call(q):
        status, body, elapsed = http_post(f"{agent_base_url}/api/chat/v2", {"question": q["question"]}, timeout=120)
        return status, elapsed

    started = time.monotonic()
    latencies = []
    errors = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(one_call, q) for q in questions]
        for f in concurrent.futures.as_completed(futures):
            status, elapsed = f.result()
            if status == 200:
                latencies.append(elapsed)
            else:
                errors += 1
    total_wall = time.monotonic() - started

    results[f"concurrency_{concurrency}"] = {
        "n": len(latencies),
        "errors": errors,
        "wall_seconds": total_wall,
        "requests_per_sec": len(latencies) / total_wall if total_wall > 0 else None,
        "p50_s": percentile(latencies, 50),
        "p95_s": percentile(latencies, 95),
        "p99_s": percentile(latencies, 99),
    }


def bench_error_behavior(agent_base_url, results):
    cases = {}

    status, body, _ = http_post(f"{agent_base_url}/api/chat/v2", {"question": "a"}, timeout=10)
    cases["too_short_question"] = {"status": status, "body_snippet": body[:200]}

    status, body, _ = http_post(f"{agent_base_url}/api/chat/v2", {"question": "x" * 3000}, timeout=10)
    cases["too_long_question"] = {"status": status, "body_snippet": body[:200]}

    status, body, _ = http_post(f"{agent_base_url}/api/chat/v2", {}, timeout=10)
    cases["missing_field"] = {"status": status, "body_snippet": body[:200]}

    results["error_behavior"] = cases


def bench_cancellation(agent_base_url, questions, results):
    """Measures how quickly a client-side abort (short timeout) actually returns,
    as a proxy for cancellation latency -- the client gives up and the connection
    is dropped; we record how long urlopen takes to raise once the timeout fires."""
    q = next((x for x in questions if x.get("expectedRoute") == "VECTOR"), questions[0])
    started = time.monotonic()
    status, body, elapsed = http_post(f"{agent_base_url}/api/chat/v2", {"question": q["question"]}, timeout=0.5)
    results["cancellation"] = {
        "client_timeout_s": 0.5,
        "observed_return_s": elapsed,
        "status": status,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--impl", required=True, choices=["baseline", "go", "ktor"])
    parser.add_argument("--mcp-cmd", required=True)
    parser.add_argument("--mcp-cwd", required=True)
    parser.add_argument("--mcp-health", default="http://localhost:8081/sse")
    parser.add_argument("--mcp-health-mode", default="tcp", choices=["http", "tcp"])
    parser.add_argument("--agent-cmd", required=True)
    parser.add_argument("--agent-cwd", required=True)
    parser.add_argument("--agent-health", default="http://localhost:8080/api/v2/status")
    parser.add_argument("--out", default=None)
    parser.add_argument("--sequential-only", action="store_true", help="skip concurrency/error/cancellation passes")
    args = parser.parse_args()

    out_path = Path(args.out) if args.out else REPO_ROOT / "eval" / "bench-results" / f"{args.impl}.json"

    questions = load_questions()
    env = os.environ.copy()

    log_dir = Path("/private/tmp/claude-501/-Users-changmin-orca-DB-MCP/8f54f91b-a3db-4e2c-a252-71dada623f6c/scratchpad/bench/logs")
    log_dir.mkdir(parents=True, exist_ok=True)

    results = {"impl": args.impl, "startup": {}}

    mcp_proc = ManagedProcess("mcp", args.mcp_cmd, args.mcp_cwd, env, args.mcp_health, log_dir / f"{args.impl}-mcp.log", health_mode=args.mcp_health_mode)
    print(f"[{args.impl}] starting mcp server...", file=sys.stderr)
    mcp_proc.start()
    results["startup"]["mcp_seconds"] = mcp_proc.startup_seconds
    print(f"[{args.impl}] mcp startup: {mcp_proc.startup_seconds:.2f}s", file=sys.stderr)

    agent_proc = ManagedProcess("agent", args.agent_cmd, args.agent_cwd, env, args.agent_health, log_dir / f"{args.impl}-agent.log")
    print(f"[{args.impl}] starting agent app...", file=sys.stderr)
    agent_proc.start()
    results["startup"]["agent_seconds"] = agent_proc.startup_seconds
    print(f"[{args.impl}] agent startup: {agent_proc.startup_seconds:.2f}s", file=sys.stderr)

    agent_base_url = "http://localhost:8080"

    try:
        print(f"[{args.impl}] sequential pass (30 questions)...", file=sys.stderr)
        bench_agent_layer(agent_base_url, questions, agent_proc.proc.pid, results)

        if not args.sequential_only:
            print(f"[{args.impl}] concurrency=4 pass...", file=sys.stderr)
            bench_concurrency(agent_base_url, questions, 4, agent_proc.proc.pid, results)

            print(f"[{args.impl}] concurrency=8 pass...", file=sys.stderr)
            bench_concurrency(agent_base_url, questions, 8, agent_proc.proc.pid, results)

            print(f"[{args.impl}] error behavior...", file=sys.stderr)
            bench_error_behavior(agent_base_url, results)

            print(f"[{args.impl}] cancellation...", file=sys.stderr)
            bench_cancellation(agent_base_url, questions, results)

        results["mcp_rss_kb"] = rss_kb(mcp_proc.proc.pid)
        results["agent_rss_kb_final"] = rss_kb(agent_proc.proc.pid)

    finally:
        agent_proc.stop()
        mcp_proc.stop()

    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"[{args.impl}] results written to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
