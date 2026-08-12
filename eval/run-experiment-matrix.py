#!/usr/bin/env python3
"""Run baseline and TACC variants by restarting agent-app with frozen evaluation settings."""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


VARIANTS = {
    "NO_TOOLS": ("NO_TOOLS", "CURRENT"),
    "VANILLA": ("VANILLA_MCP", "ALL_WITH_HARD_CAP"),
    "OURS_ALL": ("OURS", "ALL_WITH_HARD_CAP"),
    "OURS_RELEVANCE": ("OURS", "RELEVANCE"),
    "OURS_CURRENT": ("OURS", "CURRENT"),
    "OURS_COVERAGE": ("OURS", "COVERAGE"),
}


def wait_ready(base_url: str, process: subprocess.Popen[str], timeout: int = 120) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"agent exited before ready: {process.returncode}")
        try:
            with urllib.request.urlopen(f"{base_url}/api/tools", timeout=3):
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
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--split", choices=("all", "dev", "holdout"), default="all")
    parser.add_argument("--reps", type=int, default=3)
    parser.add_argument("--model", default="gemma3:1b")
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--variants", default=",".join(VARIANTS))
    args = parser.parse_args()

    chosen = [value.strip() for value in args.variants.split(",") if value.strip()]
    unknown = [value for value in chosen if value not in VARIANTS]
    if unknown:
        raise SystemExit(f"unknown variants: {unknown}; choices={list(VARIANTS)}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    reports: dict[str, str] = {}
    for variant in chosen:
        mode, policy = VARIANTS[variant]
        env = os.environ.copy()
        env.update({
            "OLLAMA_MODEL": args.model,
            "ROUTER_FALLBACK": "semantic-ai",
            "EVALUATION_MODE": mode,
            "CONTEXT_POLICY": policy,
            "EVALUATION_INCLUDE_EVIDENCE": "true",
            "EVALUATION_FAULT_ENABLED": "false",
        })
        log_path = output_dir / f"{variant.lower()}.agent.log"
        report_path = output_dir / f"{variant.lower()}.json"
        print(f"starting {variant}: mode={mode} policy={policy}", flush=True)
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
                subprocess.run(
                    [
                        "python3", "eval/run-system-eval.py",
                        "--set", args.dataset,
                        "--split", args.split,
                        "--base-url", args.base_url,
                        "--reps", str(args.reps),
                        "--output", str(report_path),
                        "--model-label", args.model,
                        "--system-mode", mode,
                        "--context-policy", policy,
                    ],
                    check=True,
                    env=env,
                )
            finally:
                stop(process)
        reports[variant] = str(report_path)

    manifest = output_dir / "matrix.json"
    manifest.write_text(json.dumps({"reports": reports}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved matrix: {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
