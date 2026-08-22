#!/usr/bin/env python3
"""'우리 시스템(에이전트+MCP+결정적 로직)' vs '그냥 gemma3:4b에 데이터셋 전체를
컨텍스트로 넣고 직접 질의응답' 비교용 naive baseline 실행기.

에이전트의 라우팅/스키마 링킹/NL2SQL/그래프 탐색/vector_search를 전혀 쓰지 않고,
dump_full_context.py로 만든 전체 데이터 텍스트를 시스템 프롬프트에 그대로 넣은 뒤
Ollama에 직접 질문한다. num_ctx를 명시적으로 늘려 컨텍스트가 잘리지 않게 한다.
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from answer_rules import grade_answer  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTEXT_FILE = REPO_ROOT / "eval" / "bench-results" / "full-context-dump.txt"


def ask_ollama(base_url: str, model: str, system: str, question: str, num_ctx: int, timeout: int) -> tuple[str, float]:
    payload = {
        "model": model,
        "prompt": question,
        "system": system,
        "stream": False,
        "options": {"num_ctx": num_ctx, "temperature": 0},
    }
    req = urllib.request.Request(
        f"{base_url}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
        return body.get("response", ""), time.monotonic() - started


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--eval-file", required=True)
    parser.add_argument("--ollama-url", default="http://localhost:11434")
    parser.add_argument("--model", default="gemma3:4b")
    parser.add_argument("--num-ctx", type=int, default=32768)
    parser.add_argument("--out", required=True)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()

    context_text = CONTEXT_FILE.read_text()
    system_prompt = (
        "너는 Company-X의 데이터 분석 비서다. 아래는 회사의 전체 데이터베이스, "
        "지식 그래프, 문서 40건이다. 이 데이터만 근거로 질문에 한국어로 간결하게 답한다. "
        "데이터에 없는 내용은 추측하지 말고 모른다고 답한다.\n\n" + context_text
    )

    questions = json.loads(Path(args.eval_file).read_text())["questions"]
    results = []

    for q in questions:
        try:
            answer, elapsed = ask_ollama(
                args.ollama_url, args.model, system_prompt, q["question"], args.num_ctx, args.timeout,
            )
        except Exception as e:
            results.append({"id": q["id"], "error": str(e)})
            print(f"[naive-llm] {q['id']}: ERROR {e}", file=sys.stderr)
            continue

        grading = grade_answer(answer, q)
        results.append({
            "id": q["id"],
            "question": q["question"],
            "answer": answer,
            "answerCorrect": grading["answerCorrect"],
            "matchedKeywords": grading["matchedKeywords"],
            "latencySeconds": elapsed,
        })
        print(
            f"[naive-llm] {q['id']}: answer={'OK' if grading['answerCorrect'] else 'MISS'} "
            f"({elapsed:.1f}s)",
            file=sys.stderr,
        )

    n = len(results)
    answer_correct = sum(1 for r in results if r.get("answerCorrect"))
    errors = sum(1 for r in results if "error" in r)

    summary = {
        "impl": "naive-llm-full-context",
        "model": args.model,
        "num_ctx": args.num_ctx,
        "n": n,
        "answer_accuracy": answer_correct / n if n else None,
        "errors": errors,
        "results": results,
    }
    Path(args.out).write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"[naive-llm] answer_correct={answer_correct}/{n} errors={errors}", file=sys.stderr)
    print(f"[naive-llm] written to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
