package recording

import (
	"context"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type fakeEnhancer struct {
	title   string
	summary string
	err     error
}

func (e fakeEnhancer) RunWithOptions(context.Context, string, ai.RunOptions) (*ai.Extraction, string, error) {
	return &ai.Extraction{Title: e.title}, e.summary, e.err
}

func (e fakeEnhancer) RefineNotes(context.Context, *ai.Extraction, string, string, string) (string, error) {
	return e.summary, e.err
}

type fakeTranscriber struct{}

func (fakeTranscriber) Transcribe(_ context.Context, audioPath, _ string) ([]transcribe.Segment, error) {
	return []transcribe.Segment{{Start: 0, End: 1, Text: filepath.Base(audioPath) + " hello"}}, nil
}
