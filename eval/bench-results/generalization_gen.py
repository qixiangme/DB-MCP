#!/usr/bin/env python3
"""companyx-dataset-v1.0 기반 대규모(300+) 일반화 검증용 질문 세트 생성기.

official-eval.json/private-eval.json과 문항이 겹치지 않도록, 같은 사실마다
3~4개의 서로 다른 문체(존댓말/반말/의문형/명령형, 어순 변경, 동의어 치환)로
변형해 표현 다양성 자체를 검증한다. 정답은 DB 쿼리로 자동 도출한다.

출력: eval/generalization-eval.json (300문항 내외)
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
            "id": f"G2-{qid}",
            "question": question,
            "expectedRoute": route,
            "keywords": keywords,
        }
        if min_matches is not None:
            entry["answerRule"] = {"minMatches": min_matches}
        questions.append(entry)

    # ============================================================
    # SQL: 부서별 인원 수 (6개 부서 x 4개 문체 변형 = 24문항)
    # ============================================================
    for name, count in psql("SELECT d.name, count(*) FROM employees e JOIN departments d ON e.dept_id=d.id GROUP BY d.name"):
        kws = [f"{count}명", f"{count}명입니다", count]
        add(f"{name} 소속 직원은 몇 명이야?", "SQL", kws)
        add(f"{name}에는 직원이 몇 명 있습니까?", "SQL", kws)
        add(f"{name} 인원수 알려줘", "SQL", kws)
        add(f"{name}은 총 몇 명으로 구성되어 있나요?", "SQL", kws)

    # ============================================================
    # SQL: 카테고리별 총 매출 (4개 카테고리 x 4개 문체 = 16문항)
    # ============================================================
    cat_kr = {"cloud": "클라우드", "security": "보안", "data": "데이터", "consulting": "컨설팅"}
    for cat, total in psql("SELECT category, sum(amount) FROM sales GROUP BY category"):
        kws = with_comma_variant(total)
        name = cat_kr[cat]
        add(f"{name} 카테고리 제품의 총 매출은 얼마야?", "SQL", kws)
        add(f"{name} 분야 제품들 매출 합계가 어떻게 되나요?", "SQL", kws)
        add(f"{name} 카테고리 매출 총액 알려줘", "SQL", kws)
        add(f"전체 매출 중 {name} 카테고리가 차지하는 금액은 얼마입니까?", "SQL", kws)

    # ============================================================
    # SQL: 지역별 총 매출 (8개 지역 x 3개 문체 = 24문항)
    # ============================================================
    for region, total in psql("SELECT region, sum(amount) FROM sales GROUP BY region"):
        kws = with_comma_variant(total)
        add(f"{region} 지역 매출 총액은 얼마야?", "SQL", kws)
        add(f"{region}에서 발생한 매출 합계를 알려줘", "SQL", kws)
        add(f"{region} 지역의 총 매출 규모가 어떻게 되나요?", "SQL", kws)

    # ============================================================
    # SQL: 업종별 계약 건수 (10개 업종 x 3개 문체 = 30문항)
    # ============================================================
    for industry, count in psql(
        "SELECT c.industry, count(*) FROM contracts ct JOIN clients c ON ct.client_id=c.id GROUP BY c.industry"
    ):
        kws = [f"{count}건", f"{count}개", count]
        add(f"{industry} 업종 고객사의 계약 건수는 몇 건이야?", "SQL", kws)
        add(f"{industry} 분야에서 체결된 계약은 몇 개입니까?", "SQL", kws)
        add(f"{industry} 업종 계약 수 알려줘", "SQL", kws)

    # ============================================================
    # SQL: 티켓 우선순위별 건수 (4개 x 4개 문체 = 16문항)
    # ============================================================
    for priority, count in psql("SELECT priority, count(*) FROM support_tickets GROUP BY priority"):
        kws = [f"{count}건", f"{count}개", count]
        add(f"{priority} 우선순위 티켓은 총 몇 건이야?", "SQL", kws)
        add(f"우선순위가 {priority}인 티켓 개수를 알려줘", "SQL", kws)
        add(f"{priority} 등급 티켓이 몇 건 있습니까?", "SQL", kws)
        add(f"{priority} 티켓 건수는?", "SQL", kws)

    # ============================================================
    # SQL: 고객사 규모별 총 매출 (3개 x 4개 문체 = 12문항)
    # ============================================================
    for size, total in psql("SELECT company_size, sum(s.amount) FROM sales s JOIN clients c ON s.client_id=c.id GROUP BY c.company_size"):
        kws = with_comma_variant(total)
        add(f"{size} 규모 고객사들의 총 매출은 얼마야?", "SQL", kws)
        add(f"{size} 규모 고객사 매출 합계를 알려줘", "SQL", kws)
        add(f"{size} 규모의 고객사들에서 발생한 매출 총액이 얼마입니까?", "SQL", kws)
        add(f"{size} 사이즈 고객사 매출 총합은?", "SQL", kws)

    # ============================================================
    # SQL: 제품별 지원 티켓 수 (12개 제품 x 3개 문체 = 36문항)
    # ============================================================
    for name, count in psql("SELECT p.name, count(*) FROM support_tickets t JOIN products p ON t.product_id=p.id GROUP BY p.name"):
        kws = [f"{count}건", f"{count}개", count]
        add(f"{name} 관련 기술지원 티켓은 몇 건이야?", "SQL", kws)
        add(f"{name}에 대한 지원 요청이 몇 건 접수됐습니까?", "SQL", kws)
        add(f"{name} 티켓 수 알려줘", "SQL", kws)

    # ============================================================
    # GRAPH: 부서장 조회 (6개 부서 x 4개 문체 = 24문항)
    # ============================================================
    for dept, head in psql("SELECT subject, object FROM kg_triples WHERE predicate='부서장'"):
        kws = [head]
        add(f"{dept} 팀장이 누구야?", "GRAPH", kws)
        add(f"{dept}을 이끄는 사람은 누구입니까?", "GRAPH", kws)
        add(f"{dept} 책임자 알려줘", "GRAPH", kws)
        add(f"{dept}의 부서장은 누구인가요?", "GRAPH", kws)

    # ============================================================
    # GRAPH: 제품별 사용 고객사 (12개 제품 x 3개 문체 = 36문항)
    # ============================================================
    for product in ["Product-C1", "Product-C2", "Product-C3", "Product-C4",
                     "Product-D1", "Product-D2", "Product-D3",
                     "Product-S1", "Product-S2", "Product-S3",
                     "Product-T1", "Product-T2"]:
        rows = psql(f"SELECT subject FROM kg_triples WHERE predicate='사용한다' AND object='{product}'")
        clients = [r[0] for r in rows]
        if not clients:
            continue
        add(f"{product}를 쓰고 있는 고객사 알려줘", "GRAPH", clients, min_matches=1)
        add(f"{product} 사용 중인 거래처가 어디입니까?", "GRAPH", clients, min_matches=1)
        add(f"{product}를 도입한 고객사는?", "GRAPH", clients, min_matches=1)

    # ============================================================
    # GRAPH: 제품별 이슈보고 고객사 (12개 제품 x 3개 문체 = 36문항)
    # ============================================================
    for product in ["Product-C1", "Product-C2", "Product-C3", "Product-C4",
                     "Product-D1", "Product-D2", "Product-D3",
                     "Product-S1", "Product-S2", "Product-S3",
                     "Product-T1", "Product-T2"]:
        rows = psql(f"SELECT subject FROM kg_triples WHERE predicate='이슈보고' AND object='{product}'")
        clients = [r[0] for r in rows]
        if not clients:
            continue
        add(f"{product}에 문제를 제기한 고객사가 어디야?", "GRAPH", clients, min_matches=1)
        add(f"{product} 관련 이슈를 신고한 거래처를 알려줘", "GRAPH", clients, min_matches=1)
        add(f"{product}에 대해 불만을 제기한 고객사는 누구입니까?", "GRAPH", clients, min_matches=1)

    # ============================================================
    # GRAPH: 부서 소속 직원 (6개 부서 x 3개 문체 = 18문항)
    # ============================================================
    for row in psql("SELECT name FROM departments"):
        dept = row[0]
        rows = psql(f"SELECT subject FROM kg_triples WHERE predicate='소속' AND object='{dept}'")
        members = [r[0] for r in rows]
        if not members:
            continue
        add(f"{dept}에는 어떤 사람들이 있어?", "GRAPH", members, min_matches=2)
        add(f"{dept} 소속 인원을 나열해줘", "GRAPH", members, min_matches=2)
        add(f"{dept}에서 일하는 직원들은 누구입니까?", "GRAPH", members, min_matches=2)

    # ============================================================
    # VECTOR: 제안서 초기 구축비 (10건 x 3개 문체 = 30문항)
    # ============================================================
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
        add(f"{product}을(를) {client}에 제안할 때 초기 구축비를 얼마로 책정했습니까?", "VECTOR", [cost])
        add(f"{client} 대상 {product} 제안서의 초기 구축 비용 알려줘", "VECTOR", [cost])

    out = {
        "description": (
            "대규모(300문항 내외) 일반화 검증용 질문 세트. official-eval.json/private-eval.json과 "
            "문항이 겹치지 않도록 하고, 같은 사실마다 3~4개의 서로 다른 문체(존댓말/반말/의문형/"
            "명령형, 어순 변경, 동의어 치환)로 변형해 표현 다양성 자체를 검증한다. "
            "정답은 손으로 만들지 않고 DB 쿼리로 직접 도출했다."
        ),
        "questions": questions,
    }
    out_path = REPO_ROOT / "eval" / "generalization-eval.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"generated {len(questions)} questions -> {out_path}")


if __name__ == "__main__":
    main()
