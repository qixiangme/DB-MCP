#!/usr/bin/env python3
"""Company-X 문서 적재를 MCP 서버 모듈의 운영 API에 위임한다."""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--docs", default="companyx-dataset-v1.0/documents")
    parser.add_argument("--server-url", default="http://localhost:8081")
    parser.add_argument("--dataset", default="companyx-v1.0")
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()

    docs = Path(args.docs).resolve()
    if not docs.is_dir() or not list(docs.glob("DOC-*.md")):
        raise SystemExit(f"no Company-X documents found under {docs}")

    query = urllib.parse.urlencode({"path": str(docs), "dataset": args.dataset})
    request = urllib.request.Request(
        f"{args.server_url.rstrip('/')}/admin/ingest-dir?{query}",
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        result = json.load(response)

    if "error" in result:
        raise SystemExit(f"ingestion failed: {result['error']}")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
