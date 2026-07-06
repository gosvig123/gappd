package recording

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
)

type trackingEnhancer struct {
	runCalled bool
	feedback  string
}

func (e *trackingEnhancer) RunWithOptions(context.Context, string, ai.RunOptions) (*ai.Extraction, string, error) {
	e.runCalled = true
	return &ai.Extraction{Title: "New"}, "new", nil
}

func (e *trackingEnhancer) RefineNotes(_ context.Context, _ *ai.Extraction, _ string, feedback string, _ string) (string, error) {
	e.feedback = feedback
	return "refined", nil
}

func TestEnhanceRefinesStoredSummaryWithFeedback(t *testing.T) {
	extractionJSON := `{"title":"Planning","participants":[],"topics":[],"decisions":[],"action_items":[],"open_questions":[],"sentiment":"neutral"}`
	summary := "draft"
	transcript := "[Ada] plan"
	store := &fakeStore{meeting: &db.Meeting{ID: "m1", Title: "Old", Transcript: &transcript, Summary: &summary, ExtractionJSON: &extractionJSON}}
	enhancer := &trackingEnhancer{}
	service := Service{Out: io.Discard, store: store, enhancer: enhancer}
	options := EnhanceOptions{Notes: "prefer bullets", Feedback: "shorter", Refine: true}

	if err := service.EnhanceWithOptions(context.Background(), "m1", options); err != nil {
		t.Fatalf("EnhanceWithOptions() error = %v", err)
	}
	if enhancer.runCalled {
		t.Fatalf("RunWithOptions called, want stored-summary refinement")
	}
	if !strings.Contains(enhancer.feedback, "prefer bullets") || !strings.Contains(enhancer.feedback, "shorter") {
		t.Fatalf("feedback = %q, want notes and feedback", enhancer.feedback)
	}
	if store.meeting.Summary == nil || *store.meeting.Summary != "refined" {
		t.Fatalf("summary = %v, want refined", store.meeting.Summary)
	}
}
