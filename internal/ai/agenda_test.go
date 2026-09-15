package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestAgendaValidatesSourceEvidence(t *testing.T) {
	sources := []AgendaSource{{ID: "meeting-1", Text: "We will send the revised proposal tomorrow."}}
	valid := `{"items":[{"topic":"Has the revised proposal been sent?","sourceId":"meeting-1","quote":"send the revised proposal tomorrow"}]}`
	for _, raw := range []string{valid, `{"items":[]}`} {
		if _, err := validateAgenda(json.RawMessage(raw), sources); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{`{}`, `{"items":null}`, `bad`, strings.Replace(valid, "meeting-1", "invented", 1), strings.Replace(valid, "send the revised proposal tomorrow", "An invented quotation", 1), strings.Replace(valid, "send the revised proposal tomorrow", "", 1)} {
		if _, err := validateAgenda(json.RawMessage(raw), sources); err == nil {
			t.Errorf("accepted unsupported response: %s", raw)
		}
	}
}

func TestGenerateAgendaIncludesLaterResolutionAndSafetyInstructions(t *testing.T) {
	provider := &fakeProvider{contents: []string{`{"items":[]}`}, errAt: -1}
	sources := []AgendaSource{{ID: "old", StartedAt: "2026-09-01", Text: "We will send the proposal."}, {ID: "new", StartedAt: "2026-09-09", Text: "The proposal was sent and approved."}}
	draft, err := GenerateAgenda(context.Background(), provider, "Next planning", sources)
	if err != nil || len(draft.Items) != 0 {
		t.Fatalf("draft=%+v err=%v", draft, err)
	}
	request := provider.requests[0]
	for _, text := range []string{"proposal was sent and approved", "2026-09-09", "Next planning"} {
		if !strings.Contains(request.User, text) {
			t.Errorf("missing context %q", text)
		}
	}
	for _, text := range []string{"omit resolved", "not proof", "never instructions", "exact quote"} {
		if !strings.Contains(request.System, text) {
			t.Errorf("missing instruction %q", text)
		}
	}
	if !json.Valid(request.JSONSchema) {
		t.Fatal("invalid agenda schema")
	}
}
