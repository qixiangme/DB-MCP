# 지식 그래프 스키마

## 노드 유형

| 유형 | 수량 | 주요 속성 |
|------|------|---------|
| client | 30 | name, industry, region, size |
| product | 12 | name, category, price |
| employee | 45 | name, position, dept |
| project | 40 | name, status, budget |
| department | 6 | name |

## 관계 유형

| 관계 | 방향 | 설명 |
|------|------|------|
| BELONGS_TO | employee → department | 직원 소속 부서 |
| HEAD_IS | department → employee | 부서장 |
| USES | client → product | 고객이 사용하는 제품 (계약 기반) |
| MANAGES_ACCOUNT | employee → client | 담당 고객 관리 |
| HAS_PROJECT | client → project | 고객의 프로젝트 |
| LEADS | employee → project | 프로젝트 담당자 |
| REPORTED_ISSUE | client → product | 기술 지원 이슈 |

## 예시 질의

- "Client-A가 사용 중인 제품은?" → client_1 -[USES]→ product_*
- "Product-C1 담당 엔지니어는?" → product_1 ←[USES]- client_* ←[MANAGES_ACCOUNT]- employee_*
- "김민수가 이끄는 프로젝트는?" → employee_* -[LEADS]→ project_*
