package router

import "testing"

func TestRouteQuestionProjector_SplitsPriceAndInstallIntoPerToolQuestions(t *testing.T) {
	p := &RouteQuestionProjector{}
	question := "Product-C1의 월 가격과 설치에 필요한 컨테이너 도구를 함께 알려줘."
	if got := p.Project(question, RouteSQL); got != "Product-C1의 월 가격 알려줘" {
		t.Fatalf("got %q", got)
	}
	if got := p.Project(question, RouteVector); got != "Product-C1 설치에 필요한 컨테이너 도구를 알려줘" {
		t.Fatalf("got %q", got)
	}
}

func TestRouteQuestionProjector_PreservesEntityForSqlAfterGraphRequest(t *testing.T) {
	p := &RouteQuestionProjector{}
	question := "Product-C1 도입 제안 대상과 현재 실제 사용 고객을 구분하고 월 가격도 알려줘."
	if got := p.Project(question, RouteSQL); got != "Product-C1 월 가격도 알려줘" {
		t.Fatalf("got %q", got)
	}
	if got := p.Project(question, RouteGraph); got != "Product-C1 현재 실제 사용 고객을 알려줘" {
		t.Fatalf("got %q", got)
	}
}

func TestRouteQuestionProjector_NoDecompositionBasisPreservesOriginal(t *testing.T) {
	p := &RouteQuestionProjector{}
	question := "단서가 전혀 없는 모호한 요청"
	if got := p.Project(question, RouteSQL); got != question {
		t.Fatalf("got %q", got)
	}
}

func TestRouteQuestionProjector_NarrativeConjunctionDecomposesPerRoute(t *testing.T) {
	p := &RouteQuestionProjector{}
	question := "Bearer 인증을 쓰고 활성 계약 금액이 22,000이며 Client-Y가 이용하는 data 제품은 무엇이야?"
	if got := p.Project(question, RouteVector); got != "Bearer 인증을 알려줘" {
		t.Fatalf("got %q", got)
	}
	if got := p.Project(question, RouteSQL); got != "Client-Y data 활성 계약 금액이 22,000 알려줘" {
		t.Fatalf("got %q", got)
	}
	if got := p.Project(question, RouteGraph); got != "Client-Y가 이용하는 data 제품은 무엇이야 알려줘" {
		t.Fatalf("got %q", got)
	}
}
