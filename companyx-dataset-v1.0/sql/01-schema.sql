-- ============================================================
-- Company-X 데이터베이스 스키마
-- 오픈소스 개발자대회 지정과제 데이터셋
-- PostgreSQL 15+ / pgvector 확장 필요
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 부서
CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,
    head_id     INTEGER,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. 직원
CREATE TABLE employees (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    email       VARCHAR(100) NOT NULL UNIQUE,
    position    VARCHAR(50) NOT NULL,
    dept_id     INTEGER NOT NULL REFERENCES departments(id),
    hire_date   DATE NOT NULL,
    salary      INTEGER NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW()
);

ALTER TABLE departments
    ADD CONSTRAINT fk_dept_head FOREIGN KEY (head_id) REFERENCES employees(id);

-- 3. 고객사
CREATE TABLE clients (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    industry        VARCHAR(50) NOT NULL,
    region          VARCHAR(30) NOT NULL,
    company_size    VARCHAR(20) NOT NULL,
    contact_name    VARCHAR(50),
    contact_email   VARCHAR(100),
    registered_at   DATE NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 4. 제품/솔루션
CREATE TABLE products (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    category        VARCHAR(50) NOT NULL,
    description     TEXT,
    price_monthly   INTEGER NOT NULL,
    version         VARCHAR(20),
    release_date    DATE,
    status          VARCHAR(20) DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 5. 계약
CREATE TABLE contracts (
    id              SERIAL PRIMARY KEY,
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    product_id      INTEGER NOT NULL REFERENCES products(id),
    manager_id      INTEGER NOT NULL REFERENCES employees(id),
    contract_type   VARCHAR(20) NOT NULL,
    amount          INTEGER NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE,
    status          VARCHAR(20) DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 6. 프로젝트
CREATE TABLE projects (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    manager_id      INTEGER NOT NULL REFERENCES employees(id),
    contract_id     INTEGER REFERENCES contracts(id),
    status          VARCHAR(20) DEFAULT 'in_progress',
    start_date      DATE NOT NULL,
    end_date        DATE,
    budget          INTEGER,
    description     TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 7. 매출
CREATE TABLE sales (
    id              SERIAL PRIMARY KEY,
    contract_id     INTEGER NOT NULL REFERENCES contracts(id),
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    product_id      INTEGER NOT NULL REFERENCES products(id),
    amount          INTEGER NOT NULL,
    sale_date       DATE NOT NULL,
    quarter         VARCHAR(10) NOT NULL,
    category        VARCHAR(50) NOT NULL,
    region          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 8. 기술 지원 티켓
CREATE TABLE support_tickets (
    id              SERIAL PRIMARY KEY,
    client_id       INTEGER NOT NULL REFERENCES clients(id),
    product_id      INTEGER NOT NULL REFERENCES products(id),
    assignee_id     INTEGER REFERENCES employees(id),
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    priority        VARCHAR(10) NOT NULL,
    status          VARCHAR(20) DEFAULT 'open',
    created_at      TIMESTAMP NOT NULL,
    resolved_at     TIMESTAMP
);

-- 9. 문서 벡터 저장소 (참가자가 임베딩 후 적재)
CREATE TABLE document_chunks (
    id              SERIAL PRIMARY KEY,
    doc_id          VARCHAR(20) NOT NULL,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    embedding       vector(768),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_sales_quarter ON sales(quarter);
CREATE INDEX idx_sales_region ON sales(region);
CREATE INDEX idx_sales_client ON sales(client_id);
CREATE INDEX idx_contracts_client ON contracts(client_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_tickets_client ON support_tickets(client_id);
CREATE INDEX idx_tickets_status ON support_tickets(status);
CREATE INDEX idx_tickets_priority ON support_tickets(priority);
CREATE INDEX idx_doc_chunks_doc ON document_chunks(doc_id);
