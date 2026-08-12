# 기여 가이드

작은 이슈 하나와 검증 가능한 PR 하나를 기본 단위로 삼습니다. 기능, 버그, 벤치마크,
문서, 리팩터링, 보안 중 목적에 맞는 양식을 선택하고 서로 다른 목적은 PR을 나눠 주세요.

전체 절차와 분류 기준은 [docs/contributing/WORKFLOW.md](docs/contributing/WORKFLOW.md),
벤치마크 무결성 규칙은 [docs/contributing/BENCHMARK_POLICY.md](docs/contributing/BENCHMARK_POLICY.md)를 따릅니다.

## 로컬 확인

```bash
bash ./gradlew test
cd client && npm ci && npm run build
```

벤치마크 변경은 위 테스트에 더해 해당 평가셋의 기준선과 후보 결과를 모두 첨부해야 합니다.
외부 동작을 바꾸는 PR은 README 또는 관련 문서도 함께 갱신합니다.

## 평가기준 근거

모든 이슈와 PR은 프로젝트 구조 및 코드 완성도, 오픈소스 발전 가능성, 개발 문서 구체성,
프로젝트 혁신성, 프로젝트 팀워크 중 주 평가항목을 하나 선택합니다. 현재 문제의 증거와
최소 0.1점 이상 기여할 수 있다는 가설, 예상 상승 폭, 구현 전후 확인 방법을 함께 적습니다.
예상 점수는 심사 결과를 보장하는 수치가 아니며, 근거가 없거나 중복되는 변경은 올리지 않습니다.

추가로 다음 항목을 빠뜨리지 않습니다.

- 보조 평가항목(해당 시)
- 기준 브랜치
- 현재 문제 증거
- 안전성
- 위험과 되돌리기

예약된 일일 검토에서도 같은 규칙을 사용합니다. 후보마다 독립 브랜치와 드래프트 PR을
사용하고 자동 병합하지 않습니다. 개선이 없으면 실패 결과를 보존한 뒤 이슈와 PR을 닫습니다.

## 보안

악용 가능한 취약점, 개인정보, 토큰, 내부 URL은 공개 이슈에 올리지 말고
[GitHub Security Advisory](https://github.com/qixiangme/DB-MCP/security/advisories/new)로 비공개 제보해 주세요.
