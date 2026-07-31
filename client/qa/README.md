# Riwonace MCP Client QA

현재 `client` React 앱을 검증하기 위한 Puppeteer QA 폴더입니다.

이 폴더는 예전 Flutter/Supabase 웹 프로젝트에서 가져온 QA 폴더를 정리한 것입니다. 현재 프로젝트에서 바로 쓰는 파일만 루트에 남겼고, 이전 프로젝트 전용 스크립트는 `archive/drane-flutter-web/` 아래로 옮겼습니다.

## 구조

```text
qa/
  config.js
  config.example.js
  package.json
  scripts/
    qa_riwonace_mcp_client.js
  screenshots/        # generated, gitignored
  results/            # generated, gitignored
  archive/
    drane-flutter-web/
```

## 실행

먼저 클라이언트를 띄웁니다.

```bash
cd client
npm run dev
```

다른 터미널에서 QA를 실행합니다.

```bash
cd client
npm run qa
```

또는 QA 폴더에서 직접 실행할 수 있습니다.

```bash
cd client/qa
npm test
```

## 환경 변수

- `QA_BASE_URL`: 테스트할 앱 주소, 기본값 `http://localhost:5173`
- `QA_CHROME`: Chrome 실행 파일 경로
- `QA_HEADLESS`: `false`로 지정하면 브라우저를 보이게 실행

## 검증 범위

`qa_riwonace_mcp_client.js`는 실제 백엔드 없이도 안정적으로 UI를 검증하도록 브라우저 요청을 목킹합니다.

- 데스크톱 초기 렌더링
- 모바일 초기 렌더링
- MCP 도구 상태 확인 버튼
- 샘플 적재 버튼
- 단일 질의 실행 결과
- 배치 실행 결과 요약
- CSV 버튼
- 모바일 버튼 크기와 텍스트 overflow

실제 서버 연동은 별도로 브라우저에서 `http://localhost:5173`에 접속해 확인하거나, `GET /api/tools`, `POST /api/chat`, `POST /mcp-admin/ingest`를 직접 호출해 확인합니다.
