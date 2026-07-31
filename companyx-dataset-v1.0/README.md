# 오픈소스 개발자대회 지정과제 — 데이터셋

## 개요

본 데이터셋은 가상의 IT 솔루션 기업 **"Company-X"**의 운영 데이터입니다.
참가자는 이 데이터를 PostgreSQL + pgvector에 적재하고, MCP 기반 AI 검색 시스템을 구축합니다.

## 기업 설정

| 항목 | 내용 |
|------|------|
| 회사명 | Company-X (Company-X) |
| 업종 | IT 솔루션 / 클라우드 인프라 |
| 규모 | 직원 45명, 고객사 30개 |
| 주요 사업 | 클라우드 마이그레이션, 보안 솔루션, 데이터 분석 플랫폼 |
| 데이터 기간 | 2024년 1월 ~ 2026년 6월 |

## 디렉토리 구조

```
dataset/
├── README.md              ← 이 파일
├── sql/
│   ├── 01-schema.sql      ← 테이블 DDL (PostgreSQL + pgvector)
│   ├── 02-data.sql        ← INSERT 데이터
│   └── erd.md             ← ERD 설명
├── documents/
│   ├── DOC-001.md ~ DOC-040.md  ← 비정형 문서 40건
│   └── index.json         ← 문서 메타데이터 인덱스
├── graph/
│   ├── nodes.json         ← 노드 정의 (고객, 제품, 직원, 프로젝트)
│   ├── edges.json         ← 관계 정의
│   └── schema.md          ← 그래프 스키마 설명
└── questions.json         ← 예시 질문 30개 + 기대 답변 + 사용 도구
```

## 각 데이터의 용도

| 데이터 | 파일 | MCP 도구 | 설명 |
|--------|------|---------|------|
| 테이블 데이터 | sql/ | NL2SQL | 정형 데이터 질의 (매출, 계약, 제품 등) |
| 문서 데이터 | documents/ | 벡터 검색 | 비정형 문서 의미 검색 (보고서, 매뉴얼 등) |
| 관계 데이터 | graph/ | 지식 그래프 | 개체 간 관계 탐색 |
| 예시 질문 | questions.json | 라우터 | 자체 테스트 및 도구 선택 검증 |

## 설치 방법

```bash
# 1. PostgreSQL + pgvector 설치
# (Ubuntu 예시)
sudo apt install postgresql postgresql-contrib
# pgvector 확장 설치는 공식 문서 참조: https://github.com/pgvector/pgvector

# 2. 데이터베이스 생성
createdb companyx

# 3. 스키마 적용
psql companyx < sql/01-schema.sql

# 4. 데이터 적재
psql companyx < sql/02-data.sql

# 5. 문서 임베딩은 참가자가 직접 구현
# Ollama + nomic-embed-text 또는 다른 임베딩 모델 사용
```

## 라이선스

본 데이터셋은 대회 참가 목적으로만 사용 가능합니다.
