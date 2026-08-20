package tools

import "testing"

// Test names mirror HybridRetrievalScoreTest.kt cases 1:1.

func TestLexicalCoverage_PrefersInstallAndContainerCluesOverIncidentAtSameVectorScore(t *testing.T) {
	query := "Product-C1의 설치에 필요한 컨테이너 도구"
	install := LexicalCoverage(query, "Product-C1 설치에는 Docker 컨테이너 도구가 필요하다")
	incident := LexicalCoverage(query, "Product-C1 장애 보고서와 복구 시간")
	if !(install > incident) {
		t.Fatalf("expected install(%v) > incident(%v)", install, incident)
	}
}

func TestLexicalCoverage_MatchesBackupClueDespiteDifferentKoreanParticles(t *testing.T) {
	relevant := LexicalCoverage("백업하고 보관 기간", "백업이 실행되며 보관은 26일이다")
	noise := LexicalCoverage("백업하고 보관 기간", "회의 일정과 참석자")
	if !(relevant > noise) {
		t.Fatalf("expected relevant(%v) > noise(%v)", relevant, noise)
	}
}
