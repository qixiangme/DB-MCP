package core

import (
	"testing"

	"github.com/riwonace/agent-app-go/internal/router"
)

func newEscalator() *ModelEscalator {
	return &ModelEscalator{Enabled: true, SmallModel: "gemma3:1b", MediumModel: "qwen2.5:3b", LargeModel: "qwen2.5:7b"}
}

func newProfile(complexity, uncertainty float64, isMultiHop bool) QueryProfile {
	return QueryProfile{
		Intent:           IntentFactual,
		Complexity:       complexity,
		Uncertainty:      uncertainty,
		RequiredEvidence: map[EvidenceType]bool{EvidenceStructuredData: true},
		SuggestedRoutes:  []router.Route{router.RouteSQL},
		IsMultiHop:       isMultiHop,
	}
}

func TestModelEscalator_LowComplexitySelectsSmall(t *testing.T) {
	sel := newEscalator().SelectModel(newProfile(0.2, 0.1, false))
	if sel.Tier != TierSmall || sel.Model != "gemma3:1b" {
		t.Fatalf("got %+v", sel)
	}
}

func TestModelEscalator_MediumComplexitySelectsMedium(t *testing.T) {
	sel := newEscalator().SelectModel(newProfile(0.5, 0.1, false))
	if sel.Tier != TierMedium || sel.Model != "qwen2.5:3b" {
		t.Fatalf("got %+v", sel)
	}
}

func TestModelEscalator_HighComplexitySelectsLarge(t *testing.T) {
	sel := newEscalator().SelectModel(newProfile(0.8, 0.1, false))
	if sel.Tier != TierLarge || sel.Model != "qwen2.5:7b" {
		t.Fatalf("got %+v", sel)
	}
}

func TestModelEscalator_HighUncertaintyBumpsOneTier(t *testing.T) {
	sel := newEscalator().SelectModel(newProfile(0.3, 0.6, false))
	if sel.Tier != TierMedium {
		t.Fatalf("got %+v", sel)
	}
}

func TestModelEscalator_MultiHopIsAtLeastMedium(t *testing.T) {
	sel := newEscalator().SelectModel(newProfile(0.2, 0.1, true))
	if sel.Tier != TierMedium {
		t.Fatalf("got %+v", sel)
	}
}

func TestModelEscalator_LowQualityRecommendsReescalation(t *testing.T) {
	current := ModelSelection{Model: "gemma3:1b", Tier: TierSmall}
	re := newEscalator().ShouldReescalate(current, 0.4, 0.5)
	if re == nil || re.Tier != TierMedium {
		t.Fatalf("got %+v", re)
	}
}

func TestModelEscalator_SufficientQualityDoesNotReescalate(t *testing.T) {
	current := ModelSelection{Model: "gemma3:1b", Tier: TierSmall}
	re := newEscalator().ShouldReescalate(current, 0.8, 0.9)
	if re != nil {
		t.Fatalf("expected nil, got %+v", re)
	}
}

func TestModelEscalator_AlreadyLargeDoesNotReescalate(t *testing.T) {
	current := ModelSelection{Model: "qwen2.5:7b", Tier: TierLarge}
	re := newEscalator().ShouldReescalate(current, 0.3, 0.3)
	if re != nil {
		t.Fatalf("expected nil, got %+v", re)
	}
}

func TestModelEscalator_DisabledAlwaysSelectsSmall(t *testing.T) {
	disabled := &ModelEscalator{Enabled: false, SmallModel: "gemma3:1b", MediumModel: "qwen2.5:3b", LargeModel: "qwen2.5:7b"}
	sel := disabled.SelectModel(newProfile(0.9, 0.9, false))
	if sel.Tier != TierSmall {
		t.Fatalf("got %+v", sel)
	}
}
