package meetingprocessing

import (
	"context"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type Service struct {
	Store       Store
	Lifecycle   Lifecycle
	Pipeline    *ai.Pipeline
	Transcriber Transcriber
	Notes       NotesGenerator
	Reporter    Reporter
	Events      EventSink
	Clock       func() time.Time
}

type appleSpeechTranscriber struct{}

func (appleSpeechTranscriber) Transcribe(ctx context.Context, path, language string) ([]transcribe.Segment, error) {
	return transcribe.TranscribeFile(ctx, path, language)
}

func (s Service) report() Reporter {
	if s.Reporter != nil {
		return s.Reporter
	}
	return noopReporter{}
}

func (s Service) notes() NotesGenerator {
	if s.Notes != nil {
		return s.Notes
	}
	return s.Pipeline
}

func (s Service) transcriber() Transcriber {
	if s.Transcriber != nil {
		return s.Transcriber
	}
	return appleSpeechTranscriber{}
}

func (s Service) now() time.Time {
	if s.Clock != nil {
		return s.Clock().UTC()
	}
	return time.Now().UTC()
}

func (s Service) require() error {
	if s.Store == nil || s.lifecycle() == nil {
		return fmt.Errorf("meeting processing: store and lifecycle are required")
	}
	if s.notes() == nil {
		return fmt.Errorf("meeting processing: notes generator is required")
	}
	return nil
}

func (s Service) lifecycle() Lifecycle {
	if s.Lifecycle != nil {
		return s.Lifecycle
	}
	store, ok := s.Store.(*db.DB)
	if !ok {
		return nil
	}
	return meetinglifecycle.New(store)
}

func (s Service) transition(ctx context.Context, id string, transition meetinglifecycle.Transition) (*db.Meeting, error) {
	result, err := s.lifecycle().Transition(ctx, id, transition)
	if err != nil {
		return nil, err
	}
	return result.Meeting, nil
}

func (s Service) processingError(operation, meetingID string, phase Phase, err error) error {
	return &ProcessingError{Operation: operation, MeetingID: meetingID, Phase: phase, Err: err}
}

func (s Service) emit(name EventName, meeting *db.Meeting, err error) error {
	if s.Events == nil {
		return nil
	}
	return s.Events.EmitProcessingEvent(Event{Name: name, Meeting: *meeting, Err: err})
}

func actionCount(extraction *ai.Extraction) int {
	if extraction == nil {
		return 0
	}
	return len(extraction.ActionItems)
}
