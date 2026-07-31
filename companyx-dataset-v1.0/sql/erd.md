# ERD — Company-X 데이터베이스

## 테이블 관계도

```
┌──────────────┐       ┌──────────────┐
│  departments │       │  employees   │
│──────────────│       │──────────────│
│ id (PK)      │◀──┐   │ id (PK)      │
│ name         │   └───│ dept_id (FK) │
│ head_id (FK) │──────▶│ name         │
└──────────────┘       │ position     │
                       │ hire_date    │
                       │ salary       │
                       └──────┬───────┘
                              │
        ┌─────────────────────┤
        ▼                     ▼
┌──────────────┐       ┌──────────────┐
│  projects    │       │  contracts   │
│──────────────│       │──────────────│
│ id (PK)      │       │ id (PK)      │
│ name         │       │ client_id FK │
│ client_id FK │       │ product_id FK│
│ manager_id FK│       │ manager_id FK│
│ status       │       │ amount       │
│ start_date   │       │ start_date   │
│ end_date     │       │ end_date     │
│ budget       │       │ status       │
└──────────────┘       └──────────────┘
        │                     │
        ▼                     ▼
┌──────────────┐       ┌──────────────┐
│  clients     │       │  products    │
│──────────────│       │──────────────│
│ id (PK)      │       │ id (PK)      │
│ name         │       │ name         │
│ industry     │       │ category     │
│ region       │       │ price        │
│ size         │       │ version      │
│ contact_name │       │ release_date │
│ contact_email│       │ status       │
└──────────────┘       └──────────────┘

┌──────────────┐       ┌──────────────────┐
│   sales      │       │ support_tickets  │
│──────────────│       │──────────────────│
│ id (PK)      │       │ id (PK)          │
│ contract_id  │       │ client_id (FK)   │
│ amount       │       │ product_id (FK)  │
│ sale_date    │       │ assignee_id (FK) │
│ quarter      │       │ priority         │
│ category     │       │ status           │
│ region       │       │ created_at       │
└──────────────┘       │ resolved_at      │
                       │ title            │
                       └──────────────────┘

┌──────────────────┐
│ document_chunks  │
│──────────────────│
│ id (PK)          │
│ doc_id           │
│ chunk_index      │
│ content          │
│ embedding vector │
│ metadata jsonb   │
└──────────────────┘
```

## 테이블 요약

| 테이블 | 행 수 | 설명 |
|--------|-------|------|
| departments | 6 | 부서 |
| employees | 45 | 직원 |
| clients | 30 | 고객사 |
| products | 12 | 제품/솔루션 |
| contracts | 65 | 계약 |
| projects | 40 | 프로젝트 |
| sales | 500 | 매출 내역 |
| support_tickets | 120 | 기술 지원 티켓 |
| document_chunks | 참가자 구현 | 문서 벡터 저장용 (빈 테이블) |
