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
	Artifacts() audioartifact.Artifacts
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
	MarkCaptureFailed(*db.Meeting, string, error) error
	MarkCaptured(*db.Meeting, string) error
	MarkProcessingStarted(*db.Meeting, string) error
	MarkProcessingFailed(*db.Meeting, string, error) error
	SaveTranscript(*db.Meeting, string, string) error
	CompleteProcessing(*db.Meeting, db.MeetingProcessingCompletion) error
	FailProcessingWithTranscript(*db.Meeting, string, string, error) error
	UpdateRecordingHeartbeat(id, updatedAt string) error
	ListStaleRecordingMeetings(cutoff string, limit int) ([]db.Meeting, error)
	ClaimStaleRecordingForProcessing(*db.Meeting, string, string) (bool, error)
	FailStaleRecording(*db.Meeting, string, string, error) (bool, error)
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

type meetingRecordingWorkflow struct {
	store    meetingStore
	recorder recorderFactory
	baseDir  string
	out      io.Writer
	errOut   io.Writer
	events   EventSink
}

func (s Service) Run(req Request) error {
	return s.recordingWorkflow().run(req, s.processing())
}

func (s Service) recordingWorkflow() meetingRecordingWorkflow {
	return meetingRecordingWorkflow{
		store: s.meetings(), recorder: s.recorder, baseDir: s.BaseDir,
		out: s.Out, errOut: s.ErrOut, events: s.Events,
	}
}

func (w meetingRecordingWorkflow) run(req Request, processing meetingProcessing) error {
	if req.Title == "" {
		req.Title = time.Now().Format("2006-01-02 15:04 recording")
	}
	req.Language = meetinglang.Normalize(req.Language)
	sessionDir, err := w.createSessionDir(req.Title)
	if err != nil {
		return err
	}
	meeting, err := w.startMeeting(req.Title, sessionDir, req.Language)
	if err != nil {
		return err
	}
	session := w.sessionFor(meeting, audioartifact.New(sessionDir))
	return w.record(req, session, sessionDir, processing)
}

func (s Service) meetings() meetingStore {
	if s.store != nil {
		return s.store
	}
	return s.Store
}

func (w meetingRecordingWorkflow) meetings() meetingStore {
	return w.store
}

func (w meetingRecordingWorkflow) newRecorder(mode capture.CaptureMode, dir string, device int) audioRecorder {
	if w.recorder != nil {
		return w.recorder(mode, dir, device)
	}
	if w.events != nil {
		return capture.NewRecorderWithOutput(mode, dir, device, io.Discard)
	}
	return capture.NewRecorder(mode, dir, device)
}

func (w meetingRecordingWorkflow) record(req Request, session recordingSession, sessionDir string, processing meetingProcessing) error {
	w.printRecordingStart(req, sessionDir)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	recorder := w.newRecorder(req.Mode, sessionDir, req.DeviceIdx)
	if err := w.startCapture(ctx, recorder, session); err != nil {
		return err
	}
	stopHeartbeat := w.startCaptureHeartbeat(session.meeting)
	if err := w.waitForStop(ctx, recorder, session); err != nil {
		stopHeartbeat()
		return err
	}
	stopHeartbeat()
	session = w.completeCapture(session, recorder)
	request := processingRequest{language: req.Language, suppressFailure: req.SuppressProcessingFailure}
	return session.finish(processing, request)
}

func (w meetingRecordingWorkflow) completeCapture(session recordingSession, recorder audioRecorder) recordingSession {
	session = session.withArtifacts(recorder.Artifacts())
	w.printRecorded(session.meeting.StartedAt)
	return session
}

func (w meetingRecordingWorkflow) printRecordingStart(req Request, sessionDir string) {
	if w.events != nil {
		return
	}
	fmt.Fprintf(w.out, "● Recording to %s (press Ctrl-C to stop)\n", sessionDir)
	fmt.Fprintf(w.out, "  mode: %s, device: [%d]\n\n", req.Mode, req.DeviceIdx)
}

func (w meetingRecordingWorkflow) startCapture(ctx context.Context, recorder audioRecorder, session recordingSession) error {
	if err := recorder.Start(ctx); err != nil {
		return session.failCapture(err)
	}
	return w.emit(EventStarted, *session.meeting, nil)
}

func (w meetingRecordingWorkflow) waitForStop(ctx context.Context, recorder audioRecorder, session recordingSession) error {
	select {
	case <-ctx.Done():
		return w.stopCapture(recorder, session)
	case err := <-recorder.Done():
		return session.failUnexpectedCaptureStop(err)
	}
}

func (w meetingRecordingWorkflow) stopCapture(recorder audioRecorder, session recordingSession) error {
	if w.events == nil {
		fmt.Fprintln(w.out, "\n● Stopping...")
	}
	if err := w.emit(EventStopping, *session.meeting, nil); err != nil {
		return err
	}
	if err := recorder.Stop(); err != nil {
		fmt.Fprintf(w.errOut, "warning: capture did not exit cleanly: %v\n", err)
		fmt.Fprintln(w.errOut, "  audio files may be incomplete")
	}
	return nil
}
