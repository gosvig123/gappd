package recording

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
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
	Transcribe(context.Context, string) ([]transcribe.Segment, error)
}

type enhancer interface {
	RunWithOptions(context.Context, string, ai.RunOptions) (*ai.Extraction, string, error)
	RefineNotes(context.Context, *ai.Extraction, string, string, string) (string, error)
}

type meetingStore interface {
	CreateMeeting(*db.Meeting) error
	UpdateMeeting(*db.Meeting) error
	UpdateRecordingHeartbeat(id, updatedAt string) error
	ReplaceSegments(meetingID string, segments []db.Segment) error
	GetMeeting(id string) (*db.Meeting, error)
	GetSegments(meetingID string) ([]db.Segment, error)
}

type recorderFactory func(capture.CaptureMode, string, int) audioRecorder

type Request struct {
	DeviceIdx                 int
	Title                     string
	Mode                      capture.CaptureMode
	Language                  string
	SuppressProcessingFailure bool
}

type Service struct {
	Store    *db.DB
	Pipeline *ai.Pipeline
	BaseDir  string
	Out      io.Writer
	ErrOut   io.Writer
	Events   EventSink
	Reporter ProcessingReporter

	store       meetingStore
	recorder    recorderFactory
	transcriber transcriber
	enhancer    enhancer
}

func (s Service) Run(req Request) error {
	if req.Title == "" {
		req.Title = time.Now().Format("2006-01-02 15:04 recording")
	}
	req.Language = meetinglang.Normalize(req.Language)
	sessionDir, err := s.createSessionDir(req.Title)
	if err != nil {
		return err
	}
	meeting, err := s.startMeeting(req.Title, sessionDir, req.Language)
	if err != nil {
		return err
	}
	session := s.sessionFor(meeting, audioartifact.New(sessionDir))
	return s.record(req, session, sessionDir)
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
	if s.Events != nil {
		return capture.NewRecorderWithOutput(mode, dir, device, io.Discard)
	}
	return capture.NewRecorder(mode, dir, device)
}

func (s Service) record(req Request, session recordingSession, sessionDir string) error {
	s.printRecordingStart(req, sessionDir)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	recorder := s.newRecorder(req.Mode, sessionDir, req.DeviceIdx)
	if err := s.startCapture(ctx, recorder, session); err != nil {
		return err
	}
	stopHeartbeat := s.startCaptureHeartbeat(session.meeting)
	if err := s.waitForStop(ctx, recorder, session); err != nil {
		stopHeartbeat()
		return err
	}
	stopHeartbeat()
	artifacts := audioartifact.FromPaths(recorder.MicPath(), recorder.SystemPath())
	session = session.withArtifacts(artifacts)
	s.printRecorded(session.meeting.StartedAt)
	return session.finish(req, s.processing())
}

func (s Service) printRecordingStart(req Request, sessionDir string) {
	if s.Events != nil {
		return
	}
	fmt.Fprintf(s.Out, "● Recording to %s (press Ctrl-C to stop)\n", sessionDir)
	fmt.Fprintf(s.Out, "  mode: %s, device: [%d]\n\n", req.Mode, req.DeviceIdx)
}

func (s Service) startCapture(ctx context.Context, recorder audioRecorder, session recordingSession) error {
	if err := recorder.Start(ctx); err != nil {
		return session.failCapture(err)
	}
	return s.emit(EventStarted, *session.meeting, nil)
}

func (s Service) waitForStop(ctx context.Context, recorder audioRecorder, session recordingSession) error {
	select {
	case <-ctx.Done():
		return s.stopCapture(recorder, session)
	case err := <-recorder.Done():
		return session.failUnexpectedCaptureStop(err)
	}
}

func (s Service) stopCapture(recorder audioRecorder, session recordingSession) error {
	if s.Events == nil {
		fmt.Fprintln(s.Out, "\n● Stopping...")
	}
	if err := s.emit(EventStopping, *session.meeting, nil); err != nil {
		return err
	}
	if err := recorder.Stop(); err != nil {
		fmt.Fprintf(s.ErrOut, "warning: capture did not exit cleanly: %v\n", err)
		fmt.Fprintln(s.ErrOut, "  audio files may be incomplete")
	}
	return nil
}
