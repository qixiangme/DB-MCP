#!/usr/bin/env python3
"""companyx-dataset-v1.0 전체(SQL 테이블 + 지식그래프 트리플 + 문서 40건)를
사람이 읽을 수 있는 텍스트로 직렬화해 하나의 프롬프트 컨텍스트로 만든다.

목적: "우리 에이전트 시스템(라우팅 + MCP tool + 결정적 SQL/그래프 로직)" vs
"그냥 gemma3:4b에 데이터셋 전체를 컨텍스트로 넣고 직접 질의응답" 비교의
대조군(naive baseline)을 만들기 위함. 에이전트가 하는 일(스키마 이해, SQL
생성, 그래프 탐색, 문서 검색)을 전혀 하지 않고, 모델이 통짜 텍스트에서
직접 답을 찾아야 한다.
"""
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCS_DIR = REPO_ROOT / "companyx-dataset-v1.0" / "documents"


def psql(sql: str) -> list[list[str]]:
    result = subprocess.run(
        [
            "docker", "exec", "-e", "PGPASSWORD=riwonace", "riwonace-postgres",
            "psql", "-U", "riwonace", "-d", "riwonace", "-t", "-A", "-F|", "-c", sql,
        ],
        capture_output=True, text=True, check=True,
    )
    lines = [line for line in result.stdout.strip().split("\n") if line]
    return [line.split("|") for line in lines]


def table_block(title: str, header: list[str], sql: str) -> str:
    rows = psql(sql)
    lines = [f"## {title}", "|".join(header)]
    for row in rows:
        lines.append("|".join(row))
    return "\n".join(lines)


def main():
    parts = ["# Company-X 전체 데이터 (SQL 테이블 요약)\n"]

    parts.append(table_block(
        "departments (부서)", ["id", "name"],
        "SELECT id, name FROM departments ORDER BY id",
    ))
    parts.append(table_block(
        "employees (직원)", ["id", "name", "position", "dept_name", "hire_date", "salary"],
        "SELECT e.id, e.name, e.position, d.name, e.hire_date, e.salary "
        "FROM employees e JOIN departments d ON e.dept_id=d.id ORDER BY e.id",
    ))
    parts.append(table_block(
        "clients (고객사)", ["id", "name", "industry", "region", "company_size", "registered_at"],
        "SELECT id, name, industry, region, company_size, registered_at FROM clients ORDER BY id",
    ))
    parts.append(table_block(
        "products (제품)", ["id", "name", "category", "price_monthly", "status"],
        "SELECT id, name, category, price_monthly, status FROM products ORDER BY id",
    ))
    parts.append(table_block(
        "contracts (계약)", ["id", "client_name", "product_name", "amount", "status", "start_date"],
        "SELECT c.id, cl.name, p.name, c.amount, c.status, c.start_date "
        "FROM contracts c JOIN clients cl ON c.client_id=cl.id JOIN products p ON c.product_id=p.id ORDER BY c.id",
    ))
    parts.append(table_block(
        "projects (프로젝트)", ["id", "name", "client_name", "status", "budget"],
        "SELECT p.id, p.name, c.name, p.status, p.budget "
        "FROM projects p JOIN clients c ON p.client_id=c.id ORDER BY p.id",
    ))
    parts.append(table_block(
        "sales (매출)", ["id", "client_name", "product_name", "amount", "sale_date", "quarter", "category", "region"],
        "SELECT s.id, c.name, p.name, s.amount, s.sale_date, s.quarter, s.category, s.region "
        "FROM sales s JOIN clients c ON s.client_id=c.id JOIN products p ON s.product_id=p.id ORDER BY s.id",
    ))
    parts.append(table_block(
        "support_tickets (기술지원 티켓)", ["id", "client_name", "product_name", "priority", "status", "created_at"],
        "SELECT t.id, c.name, p.name, t.priority, t.status, t.created_at "
        "FROM support_tickets t JOIN clients c ON t.client_id=c.id JOIN products p ON t.product_id=p.id ORDER BY t.id",
    ))

    parts.append("\n# 지식 그래프 (subject --[predicate]--> object)\n")
    triples = psql("SELECT subject, predicate, object FROM kg_triples ORDER BY subject")
    parts.append("\n".join(f"{s} --[{p}]--> {o}" for s, p, o in triples))

    parts.append("\n# 문서 40건 전문\n")
    for doc_path in sorted(DOCS_DIR.glob("DOC-*.md")):
        parts.append(f"\n--- {doc_path.name} ---\n{doc_path.read_text()}")

    full_text = "\n\n".join(parts)
    out_path = REPO_ROOT / "eval" / "bench-results" / "full-context-dump.txt"
    out_path.write_text(full_text)
    print(f"written {len(full_text)} chars, ~{len(full_text)//4} tokens (rough estimate) -> {out_path}")


if __name__ == "__main__":
    main()
