# 기여 가이드

작은 이슈 하나와 검증 가능한 PR 하나를 기본 단위로 삼습니다. 기능, 버그, 벤치마크,
문서, 리팩터링, 보안 중 목적에 맞는 양식을 선택하고 서로 다른 목적은 PR을 나눠 주세요.

전체 절차와 분류 기준은 [docs/contributing/WORKFLOW.md](docs/contributing/WORKFLOW.md),
벤치마크 무결성 규칙은 [docs/contributing/BENCHMARK_POLICY.md](docs/contributing/BENCHMARK_POLICY.md)를 따릅니다.

## 로컬 확인

```bash
./gradlew test
cd client && npm ci && npm run build
```

Unix 계열 환경에서는 clone 직후 별도 `chmod` 없이 Gradle 래퍼를 직접 실행할 수 있습니다.

벤치마크 변경은 위 테스트에 더해 해당 평가셋의 기준선과 후보 결과를 모두 첨부해야 합니다.
외부 동작을 바꾸는 PR은 README 또는 관련 문서도 함께 갱신합니다.

## 보안

악용 가능한 취약점, 개인정보, 토큰, 내부 URL은 공개 이슈에 올리지 말고
[GitHub Security Advisory](https://github.com/qixiangme/DB-MCP/security/advisories/new)로 비공개 제보해 주세요.
