# 런타임 레드팀 보안 검토

검토 기준 커밋은 `dfd979e`이며 저장소 전체 정적 감사를 수행했다. 독립 감사 3개의 62개
완독 기록을 합치고 중복을 제거해 High 6건, Medium 1건을 검증했다. 349개 전체 파일을 모두
줄 단위 완독한 것은 아니므로 coverage는 partial이다. 실제 공격 payload는 실행하지 않았고,
공식 오프라인 advisory DB가 없어 특정 Spring AI/AIR 의존성 CVE를 추정하지 않았다.

| 심각도 | 문제 | 핵심 공격 경로 |
|---|---|---|
| High | SQL 가드 우회 | 자유형 `SELECT` → 문자열 denylist → DB 소유자 계정 실행 |
| High | 인증·인가 부재 | 비인증 client → chat/MCP/admin → DB·Ollama·vector index |
| High | SQL 자원 고갈 | 큰 LIMIT·고비용 쿼리 → 전체 물질화 → 사후 4,000자 제한 |
| High | chat/ingest 자원 고갈 | 무제한 작업 큐·파일 수/byte 제한 없는 임베딩 |
| High | backend 직접 노출 | wildcard PostgreSQL/Ollama 포트와 고정 owner 자격증명 |
| High | QA 자격증명 노출 | archive 스크립트 → 외부 password grant |
| Medium | 간접 프롬프트 인젝션 | Markdown → vector search → 답변 prompt 원문 삽입 |

가장 먼저 처리할 것은 외부 QA 계정의 즉시 폐기·회전과 감사다. 공개 문서나 이슈에는 실제
비밀번호를 다시 적지 않는다. 이어서 DB owner와 `run_sql` 계정을 분리하고, DB에서 read-only,
`statement_timeout`, `lock_timeout`을 강제해야 한다. 문자열 블랙리스트는 보조 방어일 뿐
권한 경계가 될 수 없다.

Spring AI 계층에서 확인된 문제는 upstream 취약점이 아니라 통합 설정이다. `toolcallback`을
비활성화해 검색 문서가 후속 도구를 자동 호출하지 못하게 한 점은 유효한 방어다. 반면 Spring
Security가 없고, SYNC MCP 1개 세션을 전역 lock으로 직렬화하며 request timeout이 120초이고,
chat executor 큐가 무제한이라 인증 없는 요청 폭주에 취약하다. 인증·rate limit·bounded queue·
end-to-end deadline·취소 전파를 한 세트로 적용해야 한다.

AIR도 같은 인증 부재와 SQL/자원 제한 문제를 가지며, 현재 SQL 가드는 Kotlin보다 차단 범위가
좁다. Node 단일 이벤트 루프의 CPU 병목은 현재 작은 토큰 처리만으로는 실측되지 않았으므로
취약점으로 단정하지 않았다. 향후 로컬 reranking이나 대형 그래프 계산을 넣을 때 worker 또는
process 격리와 부하 테스트가 필요하다.

보안 수정은 성능 PR과 분리한다. 인증 방식과 배포 토폴로지는 사용자 선택이 필요한 큰 변경이고,
비밀 회전은 저장소 패치만으로 완료할 수 없기 때문이다.

