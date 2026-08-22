#!/usr/bin/env python3
"""완전히 새로운 가상 회사(Nova-Tech) 데이터를 holdout_test DB에 생성한다.

목적: companyx-dataset-v1.0의 실제 값(부서명, 제품명, 숫자)을 코드가 "암기"했을
위험을 배제하기 위해, 같은 스키마·같은 구조이되 완전히 다른 내용(다른 부서명,
다른 제품 코드, 다른 지역/업종, 다른 숫자)으로 테스트 데이터를 만든다. 라우팅/
NL2SQL/kg_search 로직이 실제로 스키마 구조에 대해 일반화됐는지, 아니면 여전히
Company-X 고유 명사(Product-C1, 클라우드사업부 등)에 의존하는지 검증한다.
"""
import random
import subprocess

random.seed(7)

DEPARTMENTS = ["플랫폼개발팀", "인프라운영팀", "품질보증팀", "고객성공팀", "재무회계팀", "마케팅팀"]

FIRST_NAMES = ["민서", "지호", "하은", "도현", "서윤", "예준", "채원", "시우", "다인", "우진",
               "지안", "현우", "수아", "준서", "은우", "아린", "태윤", "소율", "민준", "가은"]
LAST_NAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"]

REGIONS = ["춘천", "청주", "천안", "포항", "순천", "익산", "안동", "목포"]
INDUSTRIES = ["반도체", "물류", "화학", "게임", "식품", "조선", "항공", "패션", "출판", "농업"]
COMPANY_SIZES = ["micro", "small", "large"]
CATEGORIES = ["analytics", "network", "storage", "billing"]
CATEGORY_KR = {"analytics": "분석", "network": "네트워크", "storage": "스토리지", "billing": "빌링"}

PRODUCTS = [
    ("Nova-A1", "analytics"), ("Nova-A2", "analytics"), ("Nova-A3", "analytics"),
    ("Nova-N1", "network"), ("Nova-N2", "network"), ("Nova-N3", "network"),
    ("Nova-S1", "storage"), ("Nova-S2", "storage"), ("Nova-S3", "storage"),
    ("Nova-B1", "billing"), ("Nova-B2", "billing"),
]


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def run_sql(sql: str):
    subprocess.run(
        ["docker", "exec", "-i", "-e", "PGPASSWORD=riwonace", "riwonace-postgres",
         "psql", "-U", "riwonace", "-d", "holdout_test", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, check=True, capture_output=True,
    )


def gen_name(used: set) -> str:
    while True:
        name = random.choice(LAST_NAMES) + random.choice(FIRST_NAMES)
        if name not in used:
            used.add(name)
            return name


def main():
    stmts = []

    # departments
    dept_ids = {}
    for i, d in enumerate(DEPARTMENTS, start=1):
        dept_ids[d] = i
        stmts.append(f"INSERT INTO departments (id, name) VALUES ({i}, {sql_str(d)});")

    # employees: 6개 부서, 부서마다 3~9명 (companyx와 다른 분포)
    used_names = set()
    emp_id = 1
    emp_by_dept = {d: [] for d in DEPARTMENTS}
    dept_sizes = {"플랫폼개발팀": 9, "인프라운영팀": 7, "품질보증팀": 5, "고객성공팀": 6, "재무회계팀": 4, "마케팅팀": 3}
    positions = ["엔지니어", "매니저", "리드", "주니어", "시니어"]
    for dept, size in dept_sizes.items():
        for _ in range(size):
            name = gen_name(used_names)
            salary = random.randint(4200, 8900)
            hire_year = random.randint(2019, 2025)
            hire_month = random.randint(1, 12)
            hire_day = random.randint(1, 28)
            position = random.choice(positions)
            stmts.append(
                f"INSERT INTO employees (id, name, email, position, dept_id, hire_date, salary) VALUES "
                f"({emp_id}, {sql_str(name)}, {sql_str(f'emp{emp_id}@nova-tech.io')}, {sql_str(position)}, "
                f"{dept_ids[dept]}, '{hire_year}-{hire_month:02d}-{hire_day:02d}', {salary});"
            )
            emp_by_dept[dept].append((emp_id, name))
            emp_id += 1

    # 부서장(head_id) 지정 - 각 부서 첫 직원
    for dept, members in emp_by_dept.items():
        head_id = members[0][0]
        stmts.append(f"UPDATE departments SET head_id = {head_id} WHERE id = {dept_ids[dept]};")

    # clients: 24개 (companyx는 30개라 다른 숫자)
    client_ids = {}
    client_id = 1
    used_client_names = set()
    for _ in range(24):
        name = f"NClient-{chr(65 + (client_id - 1) % 26)}{client_id if client_id > 26 else ''}"
        client_ids[client_id] = name
        industry = random.choice(INDUSTRIES)
        region = random.choice(REGIONS)
        size = random.choice(COMPANY_SIZES)
        year = random.randint(2020, 2025)
        month = random.randint(1, 12)
        day = random.randint(1, 28)
        stmts.append(
            f"INSERT INTO clients (id, name, industry, region, company_size, registered_at) VALUES "
            f"({client_id}, {sql_str(name)}, {sql_str(industry)}, {sql_str(region)}, {sql_str(size)}, "
            f"'{year}-{month:02d}-{day:02d}');"
        )
        client_id += 1

    # products: 11개
    product_ids = {}
    for i, (name, cat) in enumerate(PRODUCTS, start=1):
        product_ids[name] = i
        price = random.randint(80, 900) * 10
        stmts.append(
            f"INSERT INTO products (id, name, category, price_monthly, status) VALUES "
            f"({i}, {sql_str(name)}, {sql_str(cat)}, {price}, 'active');"
        )

    # contracts: 각 고객사당 1~3개
    contract_id = 1
    contracts = []
    all_emp_ids = [eid for members in emp_by_dept.values() for eid, _ in members]
    for cid in client_ids:
        n = random.randint(1, 3)
        chosen_products = random.sample(list(product_ids.values()), min(n, len(product_ids)))
        for pid in chosen_products:
            amount = random.randint(500, 9000) * 100
            status = random.choices(["active", "completed", "cancelled"], weights=[70, 20, 10])[0]
            manager = random.choice(all_emp_ids)
            year = random.randint(2023, 2025)
            month = random.randint(1, 12)
            day = random.randint(1, 28)
            stmts.append(
                f"INSERT INTO contracts (id, client_id, product_id, manager_id, contract_type, amount, start_date, status) VALUES "
                f"({contract_id}, {cid}, {pid}, {manager}, 'standard', {amount}, '{year}-{month:02d}-{day:02d}', {sql_str(status)});"
            )
            contracts.append((contract_id, cid, pid))
            contract_id += 1

    # sales: 각 계약당 1~4건
    sale_id = 1
    quarters = ["2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]
    for cid_contract, client_id_, product_id_ in contracts:
        n = random.randint(1, 4)
        for _ in range(n):
            amount = random.randint(100, 3000) * 10
            quarter = random.choice(quarters)
            year, q = quarter.split("-")
            month = {"Q1": 2, "Q2": 5, "Q3": 8, "Q4": 11}[q]
            day = random.randint(1, 28)
            product_name = [k for k, v in product_ids.items() if v == product_id_][0]
            category = dict(PRODUCTS)[product_name]
            client_name = client_ids[client_id_]
            region_row = None
            stmts.append(
                f"INSERT INTO sales (id, contract_id, client_id, product_id, amount, sale_date, quarter, category, region) "
                f"SELECT {sale_id}, {cid_contract}, {client_id_}, {product_id_}, {amount}, '{year}-{month:02d}-{day:02d}', "
                f"{sql_str(quarter)}, {sql_str(category)}, region FROM clients WHERE id = {client_id_};"
            )
            sale_id += 1

    # support_tickets: 무작위 90건
    ticket_id = 1
    priorities = ["low", "medium", "high", "critical"]
    statuses = ["open", "in_progress", "resolved", "closed"]
    for _ in range(90):
        cid_ = random.choice(list(client_ids.keys()))
        pid_ = random.choice(list(product_ids.values()))
        assignee = random.choice(all_emp_ids)
        priority = random.choice(priorities)
        status = random.choice(statuses)
        year = random.randint(2024, 2026)
        month = random.randint(1, 12)
        day = random.randint(1, 28)
        stmts.append(
            f"INSERT INTO support_tickets (id, client_id, product_id, assignee_id, title, priority, status, created_at) VALUES "
            f"({ticket_id}, {cid_}, {pid_}, {assignee}, {sql_str(f'이슈-{ticket_id}')}, {sql_str(priority)}, "
            f"{sql_str(status)}, '{year}-{month:02d}-{day:02d} 09:00:00');"
        )
        ticket_id += 1

    # kg_triples: 소속, 부서장, 담당한다, 사용한다, 이슈보고, 이끈다, 프로젝트
    triples = []
    for dept, members in emp_by_dept.items():
        for eid, name in members:
            triples.append((name, "소속", dept))
        head_name = members[0][1]
        triples.append((dept, "부서장", head_name))

    # 담당한다: 직원 -> 고객사 (무작위, 직원당 0~3개)
    for eid, name in [(e, n) for members in emp_by_dept.values() for e, n in members]:
        n_clients = random.randint(0, 3)
        assigned = random.sample(list(client_ids.values()), min(n_clients, len(client_ids)))
        for c in assigned:
            triples.append((name, "담당한다", c))

    # 사용한다: 고객사 -> 제품 (계약 기반)
    for _, cid_, pid_ in contracts:
        client_name = client_ids[cid_]
        product_name = [k for k, v in product_ids.items() if v == pid_][0]
        triples.append((client_name, "사용한다", product_name))

    # 이슈보고: 고객사 -> 제품 (무작위 서브셋)
    for _, cid_, pid_ in random.sample(contracts, min(30, len(contracts))):
        client_name = client_ids[cid_]
        product_name = [k for k, v in product_ids.items() if v == pid_][0]
        triples.append((client_name, "이슈보고", product_name))

    # 이끈다: 직원 -> 프로젝트명 (고객사별 1개)
    project_themes = ["플랫폼 이전", "성능 개선", "보안 강화", "자동화 구축", "데이터 통합"]
    for cid_ in list(client_ids.keys())[:15]:
        client_name = client_ids[cid_]
        leader = random.choice(all_emp_ids)
        leader_name = [n for e, n in [(e, n) for members in emp_by_dept.values() for e, n in members] if e == leader][0]
        theme = random.choice(project_themes)
        triples.append((leader_name, "이끈다", f"{client_name} {theme}"))
        triples.append((client_name, "프로젝트", f"{client_name} {theme}"))

    for s, p, o in triples:
        stmts.append(f"INSERT INTO kg_triples (subject, predicate, object) VALUES ({sql_str(s)}, {sql_str(p)}, {sql_str(o)});")

    run_sql("\n".join(stmts))
    print(f"generated: {len(stmts)} statements, {len(emp_by_dept)} depts, {emp_id-1} employees, "
          f"{len(client_ids)} clients, {len(product_ids)} products, {len(contracts)} contracts, "
          f"{sale_id-1} sales, {ticket_id-1} tickets, {len(triples)} triples")


if __name__ == "__main__":
    main()
