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
	if extraction.Title != "Planning" || notes != "## Meeting Title\nPlanning" {
		t.Fatalf("extraction=%#v notes=%q, want refined notes", extraction, notes)
	}
	assertRequestContains(t, provider.requests, 1, 0.3, "## Current Notes", "focus action items")
}

func TestPipelineRefineNotesClearsEmptyDecisionSection(t *testing.T) {
	_, pipeline := newFakePipeline("### Summary\nMerge approval discussed.\n### Decisions\n- Approve PR")
	extraction := &Extraction{Decisions: []Decision{}, ActionItems: []ExtractedAction{}, OpenQuestions: []string{}}

	notes, err := pipeline.RefineNotes(context.Background(), extraction, "draft", "", "")
	if err != nil {
		t.Fatalf("RefineNotes returned error: %v", err)
	}
	want := "### Summary\nMerge approval discussed.\n### Decisions\nNone identified"
	if notes != want {
		t.Fatalf("RefineNotes result = %q, want %q", notes, want)
	}
}

func TestPipelineRunsAMeetingOfManyLocalChunks(t *testing.T) {
	const chunks = 30
	contents := make([]string, 0, chunks+2)
	for i := 0; i < chunks; i++ {
		contents = append(contents, `{"title":"Long Review","topics":[]}`)
	}
	contents = append(contents, `{"title":"Long Review","topics":[]}`, "### Summary\nLong review.")
	provider, pipeline := newFakePipeline(contents...)
	transcript := strings.Repeat(strings.Repeat("x", localTranscriptChunkChars-1)+"\n", chunks)

	_, _, err := pipeline.Run(context.Background(), transcript, "")
	if err != nil {
		t.Fatalf("Run error = %v, want notes for every chunk", err)
	}
	if len(provider.requests) != chunks+2 {
		t.Fatalf("requests = %d, want %d chunk extractions, one refinement, and one synthesis", len(provider.requests), chunks)
	}
}
