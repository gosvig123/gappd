package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type fakeProvider struct {
	requests []CompletionRequest
	contents []string
	errAt    int
}

func newFakePipeline(contents ...string) (*fakeProvider, *Pipeline) {
	provider := &fakeProvider{contents: contents, errAt: -1}
	return provider, NewPipeline(provider, 0.3)
}

func (p *fakeProvider) Complete(_ context.Context, req CompletionRequest) (string, error) {
	p.requests = append(p.requests, req)
	return p.contents[len(p.requests)-1], nil
}

func (p *fakeProvider) CompleteJSON(_ context.Context, req CompletionRequest) (json.RawMessage, error) {
	p.requests = append(p.requests, req)
	return json.RawMessage(p.contents[len(p.requests)-1]), nil
}

func (p *fakeProvider) Available() error { return nil }

func TestPipelineExtract(t *testing.T) {
	provider, pipeline := newFakePipeline(`{"title":"Beta Launch Planning","participants":["Ada"],"topics":[{"name":"Roadmap","summary":"Reviewed next steps"}],"decisions":[{"what":"Ship beta","who_decided":["Ada"],"context":"After demo feedback"}],"action_items":[{"task":"Draft launch plan","owner":"Ada","deadline":"Friday"}],"open_questions":["Who owns onboarding?"],"sentiment":"productive"}`)

	extraction, err := pipeline.Extract(context.Background(), "Ada: let's ship beta on Friday")
	if err != nil {
		t.Fatalf("Extract returned error: %v", err)
	}
	assertRequest(t, provider.requests, 0, 0.3, "Ada: let's ship beta on Friday")
	if extraction.Title != "Beta Launch Planning" {
		t.Fatalf("extraction.Title = %q, want generated title", extraction.Title)
	}
	if extraction.Sentiment != "productive" {
		t.Fatalf("extraction.Sentiment = %q, want productive", extraction.Sentiment)
	}
	if len(extraction.ActionItems) != 1 || extraction.ActionItems[0].Owner != "Ada" {
		t.Fatalf("extraction.ActionItems = %#v, want Ada-owned item", extraction.ActionItems)
	}
}

func TestPipelineExtractReplacesUngroundedHallucination(t *testing.T) {
	_, pipeline := newFakePipeline(`{"title":"Pre-Conference Preparation Meeting","participants":["Alex","Ben"],"topics":[{"name":"Speaker Lineup","summary":"Dr. Emily Carter and Kenji Tanaka confirmed as keynote speakers."}],"decisions":[{"what":"Proceed with marketing plan","who_decided":["Alex"],"context":"Budget constraints"}],"action_items":[{"task":"Draft content calendar","owner":"Ben","deadline":"2024-03-10"}],"open_questions":["What is the estimated attendance?"],"sentiment":"brainstorming"}`)
	transcript := "[Other] Did I do everything right?\n[Other] Did I forget something?\n[Other] Am I prepared?"

	extraction, err := pipeline.Extract(context.Background(), transcript)
	if err != nil {
		t.Fatalf("Extract returned error: %v", err)
	}
	if extraction.Title != "Transcript Notes" || len(extraction.ActionItems) != 0 || len(extraction.Decisions) != 0 {
		t.Fatalf("extraction = %#v, want conservative transcript-grounded extraction", extraction)
	}
	if len(extraction.OpenQuestions) != 3 {
		t.Fatalf("open questions = %#v, want transcript questions", extraction.OpenQuestions)
	}
}

func TestPipelineSynthesize(t *testing.T) {
	provider, pipeline := newFakePipeline("## Meeting Title\nDemo sync")
	extraction := &Extraction{Participants: []string{"Ada"}, Topics: []Topic{{Name: "Roadmap", Summary: "Reviewed next steps"}}, Decisions: []Decision{{What: "Ship beta"}}}

	notes, err := pipeline.Synthesize(context.Background(), extraction, "Emphasize launch blockers")
	if err != nil {
		t.Fatalf("Synthesize returned error: %v", err)
	}
	if notes != "## Meeting Title\nDemo sync" {
		t.Fatalf("Synthesize result = %q, want provider output", notes)
	}
	assertRequestContains(t, provider.requests, 0, 0.3, "## Extracted Data", "Emphasize launch blockers")
}

func TestPipelineSynthesizeClearsEmptyDecisionSection(t *testing.T) {
	provider, pipeline := newFakePipeline("### Summary\nMerge approval discussed.\n### Decisions\n- Approve PR")

	extraction := &Extraction{Decisions: []Decision{}, ActionItems: []ExtractedAction{}, OpenQuestions: []string{}}
	notes, err := pipeline.Synthesize(context.Background(), extraction, "")
	if err != nil {
		t.Fatalf("Synthesize returned error: %v", err)
	}
	want := "### Summary\nMerge approval discussed.\n### Decisions\nNone identified"
	if notes != want {
		t.Fatalf("Synthesize result = %q, want %q", notes, want)
	}
	assertRequestContains(t, provider.requests, 0, 0.3, `"decisions":[]`)
}

func TestPipelineRun(t *testing.T) {
	provider, pipeline := newFakePipeline(`{"title":"Weekly Sync","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`, "## Meeting Title\nWeekly sync")

	extraction, notes, err := pipeline.Run(context.Background(), "Ada: weekly sync", "")
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if extraction == nil || notes != "## Meeting Title\nWeekly sync" {
		t.Fatalf("Run extraction=%v notes=%q, want extraction and notes", extraction, notes)
	}
	assertRequest(t, provider.requests, 0, 0.3, "Ada: weekly sync")
	if strings.Contains(provider.requests[1].User, "## User Notes") {
		t.Fatalf("synthesize request user = %q, want no notes section", provider.requests[1].User)
	}
}

func TestPipelineRunChunksLongTranscript(t *testing.T) {
	provider, pipeline := newFakePipeline(
		`{"title":"First Half","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"productive"}`,
		`{"title":"Second Half","participants":["Ben"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"productive"}`,
		`{"title":"Wrap Up","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"productive"}`,
		`{"title":"Roadmap Launch Planning","participants":["Ada","Ben"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"productive"}`,
		"## Meeting Title\nMerged")
	transcript := strings.Repeat("[Ada] roadmap\n", 1000) + strings.Repeat("[Ben] launch\n", 1000)

	extraction, notes, err := pipeline.Run(context.Background(), transcript, "")
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if len(provider.requests) != 5 || notes == "" {
		t.Fatalf("requests=%d notes=%q, want chunked extraction, refinement, and synthesis", len(provider.requests), notes)
	}
	if extraction.Title != "Roadmap Launch Planning" {
		t.Fatalf("title = %q, want refined global title", extraction.Title)
	}
	if strings.Join(extraction.Participants, ",") != "Ada,Ben" {
		t.Fatalf("participants = %#v, want merged participants", extraction.Participants)
	}
}

func TestMergeExtractionsBoundsMergedItems(t *testing.T) {
	extractions := make([]*Extraction, 0, maxMergedTopics+1)
	for i := 0; i < maxMergedTopics+1; i++ {
		extractions = append(extractions, &Extraction{Topics: []Topic{{Name: strings.Repeat("topic ", i+1), Summary: "summary"}}})
	}

	merged := mergeExtractions(extractions)
	if len(merged.Topics) != maxMergedTopics {
		t.Fatalf("topics = %d, want bounded topics", len(merged.Topics))
	}
	long := mergeExtractions([]*Extraction{{Topics: []Topic{{Name: strings.Repeat("x", maxExtractionTextRunes+1)}}}})
	if len([]rune(long.Topics[0].Name)) > maxExtractionTextRunes {
		t.Fatalf("topic name runes = %d, want bounded", len([]rune(long.Topics[0].Name)))
	}
}

func assertRequest(t *testing.T, requests []CompletionRequest, idx int, temp float64, user string) {
	t.Helper()
	if len(requests) <= idx {
		t.Fatalf("request count = %d, want > %d", len(requests), idx)
	}
	if requests[idx].Temperature != temp || requests[idx].User != user {
		t.Fatalf("request = %#v, want temp %v user %q", requests[idx], temp, user)
	}
}

func assertRequestContains(t *testing.T, requests []CompletionRequest, idx int, temp float64, values ...string) {
	t.Helper()
	assertRequest(t, requests, idx, temp, requests[idx].User)
	for _, value := range values {
		if !strings.Contains(requests[idx].User, value) {
			t.Fatalf("request user = %q, want %q", requests[idx].User, value)
		}
	}
}
