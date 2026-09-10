package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type denseAgendaProvider struct{ agendaHistoryProvider }

func (p *denseAgendaProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	p.requests = append(p.requests, req)
	if !strings.Contains(req.System, "Extract") {
		return json.RawMessage(`{"items":[]}`), nil
	}
	var input struct {
		Sources []AgendaSource `json:"sources"`
	}
	json.Unmarshal([]byte(req.User), &input)
	if len(input.Sources[0].Text) > 3000 {
		return json.RawMessage(`{"complete":false,"items":[]}`), nil
	}
	return json.RawMessage(`{"complete":true,"items":[]}`), nil
}
func TestAgendaAdaptiveIncompleteRegression(t *testing.T) {
	p := &denseAgendaProvider{}
	_, err := GenerateAgenda(context.Background(), p, "Next", []AgendaSource{{ID: "meeting", Text: strings.Repeat("Meeting discussion. ", 1500)}})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.requests) < 10 {
		t.Fatalf("missing adaptive calls: %d", len(p.requests))
	}
}
