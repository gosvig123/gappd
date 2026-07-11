package meetingprocessing

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type CapturedProcessor interface {
	ProcessCaptured(context.Context, CapturedRequest) error
}

type CapturedRequest struct {
	MeetingID         string
	AudioDir          string
	Language          string
	ReuseLiveSegments bool
}

type CapturedChunkRequest struct {
	MeetingID      string
	Path           string
	Source         string
	Start          float64
	End            float64
	CanonicalStart float64
	CanonicalEnd   float64
	Language       string
}

type CapturedChunk struct {
	Path           string
	Source         string
	Start          float64
	End            float64
	CanonicalStart float64
	CanonicalEnd   float64
}

type LiveChunkOptions struct {
	Context   context.Context
	MeetingID string
	Language  string
	Chunks    func() <-chan CapturedChunk
	ErrOut    io.Writer
}

type LiveChunkResult struct {
	Processed int
	Failed    int
	Dropped   bool
}

func (r LiveChunkResult) Usable() bool { return r.Processed > 0 && r.Failed == 0 && !r.Dropped }

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

type AtomicTranscriptStore interface {
	CommitDirectTranscript(context.Context, string, string, []db.Segment, time.Time) (bool, error)
}

type Store interface {
	GetMeeting(string) (*db.Meeting, error)
	GetSegments(string) ([]db.Segment, error)
	ReplaceSegments(string, []db.Segment) error
	InsertSegment(*db.Segment) error
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
