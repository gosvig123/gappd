package liveactions

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
)

type draftProvider struct {
	t        *testing.T
	requests int
}

func (p *draftProvider) Available() error { return nil }
func (p *draftProvider) Complete(context.Context, ai.CompletionRequest) (string, error) {
	p.t.Fatal("draft must not synthesize summary")
	return "", nil
}
func (p *draftProvider) CompleteJSON(_ context.Context, _ ai.CompletionRequest) (json.RawMessage, error) {
	p.requests++
	return json.RawMessage(`{"action_items":[{"task":"Draft the launch plan","owner":"You","deadline":"","evidence":[{"speaker":"You","text":"I will draft the launch plan"}]}]}`), nil
}

func TestGenerateUsesVerifiedExtractionWithoutSynthesis(t *testing.T) {
	m, id := fixture(t)
	addSegment(t, m.Store, id, "I will draft the launch plan")
	provider := &draftProvider{t: t}
	m.Extractor = ai.NewPipeline(provider, 0)
	draft, err := m.Generate(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if provider.requests != 1 || len(draft.Actions) != 1 {
		t.Fatalf("extraction requests=%d, draft=%+v", provider.requests, draft)
	}
	assertFinalUntouched(t, m.Store, id)
}

func TestGenerateDropsActionsWithoutTranscriptEvidence(t *testing.T) {
	m, id := fixture(t)
	addSegment(t, m.Store, id, "Hello, how are you?")
	m.Extractor = ai.NewPipeline(&draftProvider{t: t}, 0)
	draft, err := m.Generate(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if len(draft.Actions) != 0 {
		t.Fatalf("unsupported action: %+v", draft.Actions)
	}
}
