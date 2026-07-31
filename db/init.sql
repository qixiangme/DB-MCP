-- Riwonace 지능형 데이터 플랫폼 초기 스키마
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 관계형 데이터 (NL2SQL 대상) ─────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
    id        SERIAL PRIMARY KEY,
    name      VARCHAR(50)  NOT NULL,
    dept      VARCHAR(50)  NOT NULL,
    role      VARCHAR(50)  NOT NULL,
    salary    INTEGER      NOT NULL,
    hired_at  DATE         NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id        SERIAL PRIMARY KEY,
    name      VARCHAR(100) NOT NULL,
    category  VARCHAR(50)  NOT NULL,
    price     INTEGER      NOT NULL,
    stock     INTEGER      NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id         SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    quantity   INTEGER NOT NULL,
    amount     INTEGER NOT NULL,
    ordered_at DATE    NOT NULL
);

-- ── 온톨로지 기반 지식 그래프 (triple store) ─────────────────
CREATE TABLE IF NOT EXISTS kg_triples (
    id        SERIAL PRIMARY KEY,
    subject   VARCHAR(100) NOT NULL,
    predicate VARCHAR(100) NOT NULL,
    object    VARCHAR(200) NOT NULL
);

INSERT INTO employees (name, dept, role, salary, hired_at) VALUES
 ('김민준', '플랫폼팀',   '백엔드 엔지니어',   6200, '2021-03-15'),
 ('이서연', '플랫폼팀',   '데이터 엔지니어',   6800, '2020-07-01'),
 ('박도윤', 'AI연구소',   'ML 엔지니어',       7500, '2019-11-20'),
 ('최지우', 'AI연구소',   '리서치 엔지니어',   7100, '2022-01-10'),
 ('정하은', '인프라팀',   'SRE',               6500, '2021-09-05'),
 ('강시우', '인프라팀',   '쿠버네티스 엔지니어', 6900, '2020-04-18'),
 ('조유나', '컨설팅본부', '솔루션 아키텍트',   8200, '2018-06-25'),
 ('윤건우', '컨설팅본부', '기술 컨설턴트',     5900, '2023-02-13');

INSERT INTO products (name, category, price, stock) VALUES
 ('air MCP Server Enterprise', 'AI 플랫폼',   12000000, 15),
 ('OpenShift 구축 패키지',      '인프라',      45000000,  5),
 ('PostgreSQL HA 클러스터',     '데이터베이스', 28000000,  8),
 ('pgvector 검색 어플라이언스', '데이터베이스', 18000000, 12),
 ('Kubernetes 운영 지원',       '인프라',       9000000, 30),
 ('LLM 온프레미스 패키지',      'AI 플랫폼',   35000000,  6);

INSERT INTO orders (product_id, quantity, amount, ordered_at) VALUES
 (1, 2, 24000000, '2026-01-15'),
 (3, 1, 28000000, '2026-02-03'),
 (4, 3, 54000000, '2026-03-21'),
 (2, 1, 45000000, '2026-04-10'),
 (6, 1, 35000000, '2026-05-02'),
 (1, 1, 12000000, '2026-05-30'),
 (5, 4, 36000000, '2026-06-14');

INSERT INTO kg_triples (subject, predicate, object) VALUES
 ('MCP',        '표준화한다',   'AI와 데이터 소스의 연결'),
 ('MCP',        '개발사',       'Anthropic'),
 ('MCP',        '대체한다',     '복잡한 RAG 파이프라인'),
 ('air',        '유형',         'MCP 서버 프레임워크'),
 ('air',        '개발사',       '리원에이스'),
 ('air',        '라이선스',     'Apache-2.0'),
 ('pgvector',   '확장한다',     'PostgreSQL'),
 ('pgvector',   '제공한다',     '벡터 유사도 검색'),
 ('TACC',       '의미한다',     '선별적 컨텍스트 큐레이션'),
 ('TACC',       '개선한다',     '소형 LLM의 응답 정확도'),
 ('Pylon-7',    '유형',         'AI 에이전트 워크플로 7계층 참조 모델'),
 ('Ollama',     '실행한다',     '온프레미스 소형 LLM'),
 ('qwen2.5:7b', '실행환경',     'Ollama'),
 ('리원에이스', '전문분야',     '오픈소스 IT 인프라 구축·운영'),
 ('리원에이스', '개발했다',     'air');
