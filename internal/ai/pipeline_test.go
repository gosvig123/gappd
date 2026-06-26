package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type ollamaTestServer struct {
	server   *httptest.Server
	requests []ollamaRequest
	contents []string
	status   int
}

func newOllamaTestServer(t *testing.T, contents ...string) *ollamaTestServer {
	t.Helper()
	h := &ollamaTestServer{contents: contents, status: http.StatusOK}
	h.server = httptest.NewServer(http.HandlerFunc(h.handleChat))
	t.Cleanup(h.server.Close)
	return h
}

func (h *ollamaTestServer) pipeline(temp float64) *Pipeline {
	return NewPipeline(NewOllama(h.server.URL, "test-model"), temp)
}

func (h *ollamaTestServer) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/chat" {
		http.NotFound(w, r)
		return
	}
	var req ollamaRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	h.requests = append(h.requests, req)
	if h.status != http.StatusOK {
		http.Error(w, `{"error":"ollama offline"}`, h.status)
		return
	}
	content := h.contents[len(h.requests)-1]
	_ = json.NewEncoder(w).Encode(ollamaResponse{Message: ollamaMessage{Content: content}})
}

func TestPipelineExtract(t *testing.T) {
	h := newOllamaTestServer(t, `{"title":"Beta Launch Planning","participants":["Ada"],"topics":[{"name":"Roadmap","summary":"Reviewed next steps"}],"decisions":[{"what":"Ship beta","who_decided":["Ada"],"context":"After demo feedback"}],"action_items":[{"task":"Draft launch plan","owner":"Ada","deadline":"Friday"}],"open_questions":["Who owns onboarding?"],"sentiment":"productive"}`)

	extraction, err := h.pipeline(0.7).Extract(context.Background(), "Ada: let's ship beta on Friday")
	if err != nil {
		t.Fatalf("Extract returned error: %v", err)
	}
	assertRequest(t, h.requests, 0, 0.7, "Ada: let's ship beta on Friday")
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

func TestPipelineSynthesize(t *testing.T) {
	h := newOllamaTestServer(t, "## Meeting Title\nDemo sync")
	extraction := &Extraction{Participants: []string{"Ada"}, Topics: []Topic{{Name: "Roadmap", Summary: "Reviewed next steps"}}}

	notes, err := h.pipeline(0.4).Synthesize(context.Background(), extraction, "Emphasize launch blockers")
	if err != nil {
		t.Fatalf("Synthesize returned error: %v", err)
	}
	if notes != "## Meeting Title\nDemo sync" {
		t.Fatalf("Synthesize result = %q, want provider output", notes)
	}
	assertRequestContains(t, h.requests, 0, 0.4, "## Extracted Data", "Emphasize launch blockers")
}

func TestPipelineRun(t *testing.T) {
	h := newOllamaTestServer(t, `{"title":"Weekly Sync","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`, "## Meeting Title\nWeekly sync")

	extraction, notes, err := h.pipeline(0.3).Run(context.Background(), "Ada: weekly sync", "")
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if extraction == nil || notes != "## Meeting Title\nWeekly sync" {
		t.Fatalf("Run extraction=%v notes=%q, want extraction and notes", extraction, notes)
	}
	assertRequest(t, h.requests, 0, 0.3, "Ada: weekly sync")
	if strings.Contains(h.requests[1].Messages[1].Content, "## User Notes") {
		t.Fatalf("synthesize request user = %q, want no notes section", h.requests[1].Messages[1].Content)
	}
}

func TestPipelineRunChunksLongTranscript(t *testing.T) {
	h := newOllamaTestServer(t,
		`{"title":"First Half","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"productive"}`,
		`{"title":"Second Half","participants":["Ben"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"productive"}`,
		`{"title":"Wrap Up","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"productive"}`,
		"## Meeting Title\nMerged")
	transcript := strings.Repeat("[Ada] roadmap\n", 1000) + strings.Repeat("[Ben] launch\n", 1000)

	extraction, notes, err := h.pipeline(0.3).Run(context.Background(), transcript, "")
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if len(h.requests) != 4 || notes == "" {
		t.Fatalf("requests=%d notes=%q, want chunked extraction and synthesis", len(h.requests), notes)
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

func TestPipelineRunReturnsExtractionWhenSynthesisFails(t *testing.T) {
	h := newOllamaTestServer(t, `{"title":"Weekly Sync","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`, `{"error":"ollama offline"}`)
	h.status = http.StatusOK
	h.contents[1] = ""
	h.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.handleChat(w, r)
		if len(h.requests) == 1 {
			h.status = http.StatusInternalServerError
		}
	})

	extraction, notes, err := h.pipeline(0.3).Run(context.Background(), "Ada: weekly sync", "follow up")
	if err == nil || !strings.Contains(err.Error(), "synthesis failed") {
		t.Fatalf("Run error = %v, want synthesis failure", err)
	}
	if extraction == nil || notes != "" {
		t.Fatalf("Run extraction=%v notes=%q, want extraction and empty notes", extraction, notes)
	}
}

func assertRequest(t *testing.T, requests []ollamaRequest, idx int, temp float64, user string) {
	t.Helper()
	if len(requests) <= idx {
		t.Fatalf("request count = %d, want > %d", len(requests), idx)
	}
	if requests[idx].Options.Temperature != temp || requests[idx].Messages[1].Content != user {
		t.Fatalf("request = %#v, want temp %v user %q", requests[idx], temp, user)
	}
}

func assertRequestContains(t *testing.T, requests []ollamaRequest, idx int, temp float64, values ...string) {
	t.Helper()
	assertRequest(t, requests, idx, temp, requests[idx].Messages[1].Content)
	for _, value := range values {
		if !strings.Contains(requests[idx].Messages[1].Content, value) {
			t.Fatalf("request user = %q, want %q", requests[idx].Messages[1].Content, value)
		}
	}
}
