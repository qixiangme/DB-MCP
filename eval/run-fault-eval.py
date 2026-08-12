#!/usr/bin/env python3
"""Restart agent-app with evaluation-only fault profiles and record degraded behavior."""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def request_json(url: str, question: str | None = None, timeout: int = 300) -> dict[str, object]:
    data = None if question is None else json.dumps({"question": question}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="GET" if data is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def wait_ready(base_url: str, process: subprocess.Popen[str], timeout: int = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"agent exited before ready: {process.returncode}")
        try:
            request_json(f"{base_url}/api/tools", timeout=3)
            return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1)
    raise TimeoutError("agent did not become ready")


def stop(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", default="eval/fault-scenarios-v1.json")
    parser.add_argument("--questions", default="eval/compositional-eval-v1.json")
    parser.add_argument("--output", default="eval/results/fault-eval-v1.json")
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--model", default="gemma3:1b")
    args = parser.parse_args()

    scenarios = json.loads(Path(args.scenarios).read_text(encoding="utf-8"))["scenarios"]
    questions = {
        item["id"]: item for item in json.loads(Path(args.questions).read_text(encoding="utf-8"))["questions"]
    }
    rows: list[dict[str, object]] = []
    for scenario in scenarios:
        env = os.environ.copy()
        env.update({
            "OLLAMA_MODEL": args.model,
            "ROUTER_FALLBACK": "semantic-ai",
            "EVALUATION_MODE": "OURS",
            "CONTEXT_POLICY": "CURRENT",
            "EVALUATION_INCLUDE_EVIDENCE": "true",
            "EVALUATION_FAULT_ENABLED": "true",
            "EVALUATION_FAULT_ROUTES": ",".join(scenario["faultRoutes"]),
            "EVALUATION_FAULT_MODE": scenario["faultMode"],
        })
        log_path = Path("eval/results") / f"{scenario['id']}.agent.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                ["./gradlew", ":agent-app:bootRun", "--no-daemon"],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
            try:
                wait_ready(args.base_url, process)
                response = request_json(
                    f"{args.base_url}/api/chat",
                    str(questions[scenario["questionId"]]["question"]),
                )
            finally:
                stop(process)

        actual_failed = sorted(str(route) for route in response.get("failedRoutes", []))
        expected_failed = sorted(str(route) for route in scenario["faultRoutes"])
        row = {
            **scenario,
            "actualFailedRoutes": actual_failed,
            "actualResponseMode": response.get("responseMode"),
            "contextSources": response.get("contextSources", []),
            "answer": response.get("answer", ""),
            "pass": (
                actual_failed == expected_failed
                and response.get("responseMode") == scenario["expectedResponseMode"]
            ),
            "log": str(log_path),
        }
        rows.append(row)
        print(f"[{scenario['id']}] {'PASS' if row['pass'] else 'FAIL'} {actual_failed} {row['actualResponseMode']}")

    report = {
        "metadata": {
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "model": args.model,
            "scenarios": args.scenarios,
        },
        "summary": {"passed": sum(bool(row["pass"]) for row in rows), "total": len(rows)},
        "rows": rows,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if report["summary"]["passed"] == report["summary"]["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
