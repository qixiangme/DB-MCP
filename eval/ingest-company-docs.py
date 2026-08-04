#!/usr/bin/env python3
"""Company-X Markdown 문서를 Ollama로 임베딩해 benchmark DB에 적재한다."""

from __future__ import annotations

import argparse
import json
import subprocess
import urllib.request
from pathlib import Path


def embed(base_url: str, model: str, text: str) -> list[float]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/embeddings",
        data=json.dumps({"model": model, "prompt": text}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)["embedding"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--docs", default="companyx-dataset-v1.0/documents")
    parser.add_argument("--base-url", default="http://localhost:11434")
    parser.add_argument("--model", default="nomic-embed-text")
    parser.add_argument("--container", default="riwonace-postgres")
    parser.add_argument("--database", default="riwonace")
    parser.add_argument("--user", default="riwonace")
    args = parser.parse_args()

    documents = sorted(Path(args.docs).glob("DOC-*.md"))
    if not documents:
        raise SystemExit(f"no documents found under {args.docs}")

    statements = [
        "BEGIN;",
        "DELETE FROM vector_store WHERE metadata->>'dataset' = 'companyx-v1.0';",
    ]
    for index, path in enumerate(documents, 1):
        content = path.read_text(encoding="utf-8")
        vector = embed(args.base_url, args.model, content)
        metadata = json.dumps(
            {"source": path.name, "dataset": "companyx-v1.0"},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        vector_text = "[" + ",".join(format(value, ".9g") for value in vector) + "]"
        statements.append(
            "INSERT INTO vector_store (content, metadata, embedding) VALUES "
            f"($company_doc${content}$company_doc$, $company_meta${metadata}$company_meta$::json, "
            f"$company_vec${vector_text}$company_vec$::vector);"
        )
        print(f"embedded {index:02d}/{len(documents)} {path.name}")
    statements.extend(["COMMIT;", "SELECT count(*) FROM vector_store WHERE metadata->>'dataset' = 'companyx-v1.0';"])

    completed = subprocess.run(
        [
            "docker", "exec", "-i", args.container,
            "psql", "-v", "ON_ERROR_STOP=1", "-U", args.user, "-d", args.database, "-At",
        ],
        input="\n".join(statements),
        text=True,
        check=True,
        capture_output=True,
    )
    print(f"loaded Company-X documents: {completed.stdout.strip().splitlines()[-1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
