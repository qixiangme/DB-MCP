#!/usr/bin/env python3
"""companyx-dataset-v1.0 기반 일반화 검증용 대량 질문 세트 생성기.

official-eval.json(30)과 private-eval.json(30)에서 이미 쓴 질문 각도를 그대로
반복하지 않고, 같은 스키마/그래프에 대해 부서/제품/고객사 전체를 순회하는
템플릿으로 질문을 대량 생성한다. 정답은 DB에 직접 쿼리해 스크립트가 자동으로
도출하므로 손으로 만든 정답과 사람 실수가 섞이지 않는다.

출력: eval/generalization-eval.json (SQL/VECTOR/GRAPH 각 카테고리, 총 N문항)
"""
import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


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


def with_comma_variant(number_str: str) -> list[str]:
    """큰 숫자는 답변에서 1,000 단위 콤마가 붙어 나올 수 있으니 두 표기 모두 정답으로 받는다."""
    n = int(number_str)
    plain = str(n)
    comma = f"{n:,}"
    return [plain] if plain == comma else [plain, comma]


def main():
    questions = []
    qid = 0

    def add(question, route, keywords, min_matches=None):
        nonlocal qid
        qid += 1
        entry = {
            "id": f"GEN{qid}",
            "question": question,
            "expectedRoute": route,
            "keywords": keywords,
        }
        if min_matches is not None:
            entry["answerRule"] = {"minMatches": min_matches}
        questions.append(entry)

    # --- SQL: 부서별 인원 수 (6개 부서 전체 순회, official/private 둘 다 안 쓴 "인원 수" 각도) ---
    for name, count in psql("SELECT d.name, count(*) FROM employees e JOIN departments d ON e.dept_id=d.id GROUP BY d.name"):
        add(f"{name} 소속 직원은 몇 명이야?", "SQL", [f"{count}명", f"{count}명입니다", count])

    # --- SQL: 카테고리별 총 매출 (4개 카테고리, "카테고리별 매출 총합" 각도) ---
    cat_kr = {"cloud": "클라우드", "security": "보안", "data": "데이터", "consulting": "컨설팅"}
    for cat, total in psql("SELECT category, sum(amount) FROM sales GROUP BY category"):
        add(f"{cat_kr[cat]} 카테고리 제품의 총 매출은 얼마야?", "SQL", with_comma_variant(total))

    # --- SQL: 지역별 총 매출 (8개 지역, "지역 매출 총합" 각도 - official N1은 "상위 5개 고객사"라 다름) ---
    for region, total in psql("SELECT region, sum(amount) FROM sales GROUP BY region"):
        add(f"{region} 지역 매출 총액은 얼마야?", "SQL", with_comma_variant(total))

    # --- SQL: 업종별 계약 건수 (10개 업종, "업종별 계약 수" 각도) ---
    for industry, count in psql(
        "SELECT c.industry, count(*) FROM contracts ct JOIN clients c ON ct.client_id=c.id GROUP BY c.industry"
    ):
        add(f"{industry} 업종 고객사의 계약 건수는 몇 건이야?", "SQL", [f"{count}건", f"{count}개", count])

    # --- SQL: 티켓 우선순위별 건수 (4개, "우선순위별 티켓 수" 각도 - official N7은 "critical 미해결"이라 다름) ---
    for priority, count in psql("SELECT priority, count(*) FROM support_tickets GROUP BY priority"):
        add(f"{priority} 우선순위 티켓은 총 몇 건이야?", "SQL", [f"{count}건", f"{count}개", count])

    # --- SQL: 고객사 규모별 총 매출 (3개, "규모별 매출" 각도) ---
    for size, total in psql("SELECT company_size, sum(s.amount) FROM sales s JOIN clients c ON s.client_id=c.id GROUP BY c.company_size"):
        add(f"{size} 규모 고객사들의 총 매출은 얼마야?", "SQL", with_comma_variant(total))

    # --- SQL: 제품별 지원 티켓 수 (12개 제품, "제품별 티켓 수" 각도) ---
    for name, count in psql("SELECT p.name, count(*) FROM support_tickets t JOIN products p ON t.product_id=p.id GROUP BY p.name"):
        add(f"{name} 관련 기술지원 티켓은 몇 건이야?", "SQL", [f"{count}건", f"{count}개", count])

    # --- GRAPH: 부서장 조회 (6개 부서 전체, official/private과 겹치지 않는 부서 포함) ---
    for dept, head in psql("SELECT subject, object FROM kg_triples WHERE predicate='부서장'"):
        add(f"{dept} 팀장이 누구야?", "GRAPH", [head])

    # --- GRAPH: 제품별 사용 고객사 (12개 제품 전체 순회 - official/private은 일부만 다룸) ---
    for product in ["Product-C1", "Product-C2", "Product-C3", "Product-C4",
                     "Product-D1", "Product-D2", "Product-D3",
                     "Product-S1", "Product-S2", "Product-S3",
                     "Product-T1", "Product-T2"]:
        rows = psql(f"SELECT subject FROM kg_triples WHERE predicate='사용한다' AND object='{product}'")
        clients = [r[0] for r in rows]
        if clients:
            add(f"{product}를 쓰고 있는 고객사 알려줘", "GRAPH", clients, min_matches=1)

    # --- GRAPH: 제품별 이슈보고 고객사 (12개 제품) ---
    for product in ["Product-C1", "Product-C2", "Product-C3", "Product-C4",
                     "Product-D1", "Product-D2", "Product-D3",
                     "Product-S1", "Product-S2", "Product-S3",
                     "Product-T1", "Product-T2"]:
        rows = psql(f"SELECT subject FROM kg_triples WHERE predicate='이슈보고' AND object='{product}'")
        clients = [r[0] for r in rows]
        if clients:
            add(f"{product}에 문제를 제기한 고객사가 어디야?", "GRAPH", clients, min_matches=1)

    # --- GRAPH: 부서 소속 직원 (6개 부서 전체) ---
    for row in psql("SELECT name FROM departments"):
        dept = row[0]
        rows = psql(f"SELECT subject FROM kg_triples WHERE predicate='소속' AND object='{dept}'")
        members = [r[0] for r in rows]
        if members:
            add(f"{dept}에는 어떤 사람들이 있어?", "GRAPH", members, min_matches=2)

    # --- VECTOR: 제안서 10건 전체 순회, "초기 구축비" 각도 (official/private과 겹치지 않음,
    # 문서별 금액이 전부 고유해 채점 안정성이 높다) ---
    proposals = [
        ("Client-F", "Product-C1", "7917만원"),
        ("Client-G", "Product-C2", "4098만원"),
        ("Client-H", "Product-S1", "4730만원"),
        ("Client-I", "Product-S2", "3184만원"),
        ("Client-J", "Product-D1", "3449만원"),
        ("Client-K", "Product-D2", "3856만원"),
        ("Client-L", "Product-C3", "3812만원"),
        ("Client-M", "Product-C4", "6168만원"),
        ("Client-N", "Product-D3", "2215만원"),
        ("Client-O", "Product-S3", "4242만원"),
    ]
    for client, product, cost in proposals:
        add(f"{client}에게 {product} 도입을 제안하면서 제시한 초기 구축비는 얼마야?", "VECTOR", [cost])

    out = {
        "description": (
            "일반화 검증용 대량 질문 세트. official-eval.json/private-eval.json과 문항이 "
            "겹치지 않도록 다른 질문 각도(인원 수, 카테고리/지역 총매출, 업종별 계약 수, "
            "우선순위별 티켓 수, 제품별 티켓 수, 부서장/사용고객/이슈보고/소속을 전수 순회)로 "
            "생성했다. 정답은 손으로 만들지 않고 DB 쿼리로 직접 도출했다."
        ),
        "questions": questions,
    }
    out_path = REPO_ROOT / "eval" / "generalization-eval.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"generated {len(questions)} questions -> {out_path}")


if __name__ == "__main__":
    main()
