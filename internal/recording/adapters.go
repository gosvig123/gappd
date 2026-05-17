package recording

import (
	"context"

	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type whisperTranscriber struct{}

func (whisperTranscriber) Transcribe(ctx context.Context, audioPath, modelPath string) ([]transcribe.Segment, error) {
	return transcribe.TranscribeFile(ctx, audioPath, modelPath)
}

func (s Service) meetings() meetingStore {
	if s.store != nil {
		return s.store
	}
	return s.Store
}

func (s Service) newRecorder(mode capture.CaptureMode, dir string, device int) audioRecorder {
	if s.recorder != nil {
		return s.recorder(mode, dir, device)
	}
	return capture.NewRecorder(mode, dir, device)
}

func (s Service) transcriptions() transcriber {
	if s.transcriber != nil {
		return s.transcriber
	}
	return whisperTranscriber{}
}

func (s Service) enhancements() enhancer {
	if s.enhancer != nil {
		return s.enhancer
	}
	return s.Pipeline
}
