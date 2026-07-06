package recording

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
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

type fakeRecorder struct {
	dir  string
	done chan error
}

func (r *fakeRecorder) Start(context.Context) error {
	artifacts := r.Artifacts()
	if err := os.WriteFile(artifacts.MicPath(), []byte(strings.Repeat("m", 45)), 0o644); err != nil {
		return err
	}
	return os.WriteFile(artifacts.SystemPath(), []byte(strings.Repeat("s", 45)), 0o644)
}

func (r *fakeRecorder) Stop() error { return nil }

func (r *fakeRecorder) Done() <-chan error { return r.done }

func (r *fakeRecorder) Artifacts() audioartifact.Artifacts { return audioartifact.New(r.dir) }

type fakeTranscriber struct{}

func (fakeTranscriber) Transcribe(_ context.Context, audioPath, _ string) ([]transcribe.Segment, error) {
	return []transcribe.Segment{{Start: 0, End: 1, Text: filepath.Base(audioPath) + " hello"}}, nil
}
