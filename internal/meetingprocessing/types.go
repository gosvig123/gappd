package meetingprocessing

import (
	"context"
	"errors"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type StoredRequest struct {
	MeetingID string
	Notes     string
	Feedback  string
	Refine    bool
	Language  string
}

type Phase string

const (
	PhaseValidation Phase = "validation"
	PhaseLifecycle  Phase = "lifecycle"
	PhasePersist    Phase = "persist"
	PhaseEvent      Phase = "event"
)

type ProcessingError struct {
	Operation string
	MeetingID string
	Phase     Phase
	Err       error
}

func (e *ProcessingError) Error() string {
	return e.Operation + " " + e.MeetingID + ": " + e.Err.Error()
}
func (e *ProcessingError) Unwrap() error { return e.Err }

var (
	ErrNoAudio      = errors.New("no audio captured")
	ErrNoTranscript = errors.New("no transcript found")
)

type Store interface {
	GetMeeting(string) (*db.Meeting, error)
	GetSegments(string) ([]db.Segment, error)
}

type Lifecycle interface {
	Transition(context.Context, string, meetinglifecycle.Transition) (meetinglifecycle.Result, error)
}

type Transcriber interface {
	Transcribe(context.Context, string, string) ([]transcribe.Segment, error)
}

type NotesGenerator interface {
	RunWithOptions(context.Context, string, ai.RunOptions) (*ai.Extraction, string, error)
	RefineNotes(context.Context, *ai.Extraction, string, string, string) (string, error)
}
