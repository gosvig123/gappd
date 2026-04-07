package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type fakeInferenceProvider struct {
	completeResult string
	completeErr    error
	jsonResult     json.RawMessage
	jsonErr        error
	requests       []CompletionRequest
}

func (f *fakeInferenceProvider) Complete(ctx context.Context, req CompletionRequest) (string, error) {
	f.requests = append(f.requests, req)
	if f.completeErr != nil {
		return "", f.completeErr
	}
	return f.completeResult, nil
}

func (f *fakeInferenceProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	f.requests = append(f.requests, req)
	if f.jsonErr != nil {
		return nil, f.jsonErr
	}
	return f.jsonResult, nil
}

func (f *fakeInferenceProvider) Available() error {
	return nil
}

func TestPipelineExtract(t *testing.T) {
	provider := &fakeInferenceProvider{jsonResult: json.RawMessage(`{"participants":["Ada"],"topics":[{"name":"Roadmap","summary":"Reviewed next steps"}],"decisions":[{"what":"Ship beta","who_decided":["Ada"],"context":"After demo feedback"}],"action_items":[{"task":"Draft launch plan","owner":"Ada","deadline":"Friday"}],"open_questions":["Who owns onboarding?"],"sentiment":"productive"}`)}
	pipeline := NewPipeline(provider, 0.7)

	extraction, err := pipeline.Extract(context.Background(), "Ada: let's ship beta on Friday")
	if err != nil {
		t.Fatalf("Extract returned error: %v", err)
	}
	if len(provider.requests) != 1 {
		t.Fatalf("provider request count = %d, want 1", len(provider.requests))
	}
	if provider.requests[0].Temperature != 0.7 {
		t.Fatalf("request temperature = %v, want %v", provider.requests[0].Temperature, 0.7)
	}
	if provider.requests[0].User != "Ada: let's ship beta on Friday" {
		t.Fatalf("request user = %q, want transcript", provider.requests[0].User)
	}
	if extraction.Sentiment != "productive" {
		t.Fatalf("extraction.Sentiment = %q, want %q", extraction.Sentiment, "productive")
	}
	if len(extraction.ActionItems) != 1 || extraction.ActionItems[0].Owner != "Ada" {
		t.Fatalf("extraction.ActionItems = %#v, want Ada-owned action item", extraction.ActionItems)
	}
}

func TestPipelineSynthesize(t *testing.T) {
	provider := &fakeInferenceProvider{completeResult: "## Meeting Title\nDemo sync"}
	pipeline := NewPipeline(provider, 0.4)
	extraction := &Extraction{
		Participants: []string{"Ada"},
		Topics:       []Topic{{Name: "Roadmap", Summary: "Reviewed next steps"}},
	}

	notes, err := pipeline.Synthesize(context.Background(), extraction, "Emphasize launch blockers")
	if err != nil {
		t.Fatalf("Synthesize returned error: %v", err)
	}
	if notes != "## Meeting Title\nDemo sync" {
		t.Fatalf("Synthesize result = %q, want provider output", notes)
	}
	if len(provider.requests) != 1 {
		t.Fatalf("provider request count = %d, want 1", len(provider.requests))
	}
	if provider.requests[0].Temperature != 0.4 {
		t.Fatalf("request temperature = %v, want %v", provider.requests[0].Temperature, 0.4)
	}
	if !strings.Contains(provider.requests[0].User, "## Extracted Data") {
		t.Fatalf("request user = %q, want extracted data section", provider.requests[0].User)
	}
	if !strings.Contains(provider.requests[0].User, "Emphasize launch blockers") {
		t.Fatalf("request user = %q, want user notes", provider.requests[0].User)
	}
}

func TestPipelineRun(t *testing.T) {
	provider := &fakeInferenceProvider{
		jsonResult:     json.RawMessage(`{"participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`),
		completeResult: "## Meeting Title\nWeekly sync",
	}
	pipeline := NewPipeline(provider, 0.3)

	extraction, notes, err := pipeline.Run(context.Background(), "Ada: weekly sync", "")
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if extraction == nil {
		t.Fatal("Run extraction = nil, want extraction")
	}
	if notes != "## Meeting Title\nWeekly sync" {
		t.Fatalf("Run notes = %q, want provider output", notes)
	}
	if len(provider.requests) != 2 {
		t.Fatalf("provider request count = %d, want 2", len(provider.requests))
	}
	if provider.requests[0].User != "Ada: weekly sync" {
		t.Fatalf("extract request user = %q, want transcript", provider.requests[0].User)
	}
	if strings.Contains(provider.requests[1].User, "## User Notes") {
		t.Fatalf("synthesize request user = %q, want no user notes section", provider.requests[1].User)
	}
}

func TestPipelineRunReturnsExtractionWhenSynthesisFails(t *testing.T) {
	provider := &fakeInferenceProvider{
		jsonResult:  json.RawMessage(`{"participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`),
		completeErr: errors.New("ollama offline"),
	}
	pipeline := NewPipeline(provider, 0.3)

	extraction, notes, err := pipeline.Run(context.Background(), "Ada: weekly sync", "follow up")
	if err == nil {
		t.Fatal("Run error = nil, want error")
	}
	if !strings.Contains(err.Error(), "synthesis failed: ollama offline") {
		t.Fatalf("Run error = %q, want synthesis context", err)
	}
	if extraction == nil {
		t.Fatal("Run extraction = nil, want extraction")
	}
	if notes != "" {
		t.Fatalf("Run notes = %q, want empty string", notes)
	}
}
