package recording

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type EventName string

const (
	EventStarted    EventName = "recording.started"
	EventStopping   EventName = "recording.stopping"
	EventProcessing EventName = "recording.processing"
	EventCompleted  EventName = "recording.completed"
	EventFailed     EventName = "recording.failed"

	recordingHeartbeatInterval = 30 * time.Second
)

// AllEventNames is the canonical enumeration of recording protocol events,
// used by cmd/gen-protocol to generate the TypeScript protocol definitions.
var AllEventNames = []EventName{EventStarted, EventStopping, EventProcessing, EventCompleted, EventFailed}

type EventSink interface {
	EmitRecordingEvent(EventName, db.Meeting, error) error
}

type audioRecorder interface {
	Start(context.Context) error
	Stop() error
	Done() <-chan error
	MicPath() string
	SystemPath() string
}

type transcriber interface {
	Transcribe(context.Context, string, string) ([]transcribe.Segment, error)
}

type enhancer interface {
	Run(context.Context, string, string) (*ai.Extraction, string, error)
}

type meetingStore interface {
	CreateMeeting(*db.Meeting) error
	UpdateMeeting(*db.Meeting) error
	UpdateRecordingHeartbeat(id, updatedAt string) error
	UpdateTranscript(id, transcript string) error
	InsertSegments([]db.Segment) error
	GetMeeting(id string) (*db.Meeting, error)
	GetSegments(meetingID string) ([]db.Segment, error)
}

type recorderFactory func(capture.CaptureMode, string, int) audioRecorder

type Request struct {
	DeviceIdx                 int
	Title                     string
	ModelPath                 string
	DefaultModelPath          string
	Mode                      capture.CaptureMode
	LiveTranscript            bool
	SuppressProcessingFailure bool
}

type Service struct {
	Store    *db.DB
	Pipeline *ai.Pipeline
	BaseDir  string
	Out      io.Writer
	ErrOut   io.Writer
	Events   EventSink

	store       meetingStore
	recorder    recorderFactory
	transcriber transcriber
	enhancer    enhancer
}

func (s Service) Run(req Request) error {
	if req.Title == "" {
		req.Title = time.Now().Format("2006-01-02 15:04 recording")
	}
	sessionDir, err := s.createSessionDir(req.Title)
	if err != nil {
		return err
	}
	meeting, err := s.startMeeting(req.Title, sessionDir)
	if err != nil {
		return err
	}
	return s.record(req, meeting, sessionDir)
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

func (s Service) record(req Request, meeting *db.Meeting, sessionDir string) error {
	if s.Events == nil {
		fmt.Fprintf(s.Out, "● Recording to %s (press Ctrl-C to stop)\n", sessionDir)
		fmt.Fprintf(s.Out, "  mode: %s, device: [%d]\n\n", req.Mode, req.DeviceIdx)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	recorder := s.newRecorder(req.Mode, sessionDir, req.DeviceIdx)
	if err := recorder.Start(ctx); err != nil {
		return s.FailCapture(meeting, err)
	}
	if err := s.emit(EventStarted, *meeting, nil); err != nil {
		return err
	}
	stopLiveTranscript := s.startLiveTranscript(ctx, meeting, recorder, req)
	stopHeartbeat := s.startCaptureHeartbeat(meeting)
	if err := s.waitForStop(ctx, recorder, meeting); err != nil {
		stopHeartbeat()
		stopLiveTranscript()
		return err
	}
	stopHeartbeat()
	stopLiveTranscript()
	return s.finish(req, meeting, recorder)
}

func (s Service) waitForStop(ctx context.Context, recorder audioRecorder, meeting *db.Meeting) error {
	select {
	case <-ctx.Done():
		if s.Events == nil {
			fmt.Fprintln(s.Out, "\n● Stopping...")
		}
		if err := s.emit(EventStopping, *meeting, nil); err != nil {
			return err
		}
		if err := recorder.Stop(); err != nil {
			fmt.Fprintf(s.ErrOut, "warning: capture did not exit cleanly: %v\n", err)
			fmt.Fprintln(s.ErrOut, "  audio files may be incomplete")
		}
	case err := <-recorder.Done():
		unexpectedErr := fmt.Errorf("capture stopped unexpectedly")
		if err != nil {
			unexpectedErr = fmt.Errorf("capture stopped unexpectedly: %w", err)
		}
		if failErr := s.FailCapture(meeting, unexpectedErr); failErr != nil {
			return failErr
		}
		return unexpectedErr
	}
	return nil
}

func (s Service) finish(req Request, meeting *db.Meeting, recorder audioRecorder) error {
	s.printRecorded(meeting.StartedAt)
	now := nowUTC()
	meeting.EndedAt = &now
	if !hasCapturedAudio(recorder) {
		captureErr := fmt.Errorf("no audio captured")
		if err := s.FailCapture(meeting, captureErr); err != nil {
			return err
		}
		return captureErr
	}
	setCaptureStatus(meeting, db.CaptureStatusCaptured, now, nil)
	setProcessingStatus(meeting, db.ProcessingStatusProcessing, now, nil)
	if err := s.meetings().UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("mark meeting captured: %w", err)
	}
	if err := s.emit(EventProcessing, *meeting, nil); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	err := s.postProcess(ctx, meeting, recorder, req.ModelPath, req.DefaultModelPath)
	if err != nil && req.SuppressProcessingFailure {
		fmt.Fprintf(s.ErrOut, "warning: post-processing failed after capture: %v\n", err)
		return nil
	}
	return err
}
