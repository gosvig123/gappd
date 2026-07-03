package ai

import (
	"context"
	"strings"
	"testing"
)

func TestPipelineRunRefinesExistingNotes(t *testing.T) {
	provider, pipeline := newFakePipeline(
		`{"title":"Planning","participants":["Ada"],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`,
		"## Meeting Title\nSharper notes")
	options := RunOptions{PreviousNotes: "## Meeting Title\nDraft", Feedback: "focus action items"}

	extraction, notes, err := pipeline.RunWithOptions(context.Background(), "Ada: plan launch", options)
	if err != nil {
		t.Fatalf("RunWithOptions returned error: %v", err)
	}
	if extraction.Title != "Planning" || notes != "## Meeting Title\nSharper notes" {
		t.Fatalf("extraction=%#v notes=%q, want refined notes", extraction, notes)
	}
	assertRequestContains(t, provider.requests, 1, 0.3, "## Current Notes", "focus action items")
}

func TestPipelineRejectsTooManyChunks(t *testing.T) {
	_, pipeline := newFakePipeline()
	transcript := strings.Repeat(strings.Repeat("x", maxTranscriptChunkChars)+"\n", maxTranscriptChunks+1)

	_, _, err := pipeline.Run(context.Background(), transcript, "")
	if err == nil || !strings.Contains(err.Error(), "transcript too large") {
		t.Fatalf("Run error = %v, want transcript too large", err)
	}
}
