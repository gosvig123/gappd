package recording

import (
	"context"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/transcribe"
)

type fakeTranscriber struct{}

func (fakeTranscriber) Transcribe(_ context.Context, audioPath, _ string) ([]transcribe.Segment, error) {
	return []transcribe.Segment{{Start: 0, End: 1, Text: filepath.Base(audioPath) + " hello"}}, nil
}
