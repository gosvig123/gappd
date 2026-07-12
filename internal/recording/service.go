package recording

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/capture"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

type EventName string

const (
	EventStarted  EventName = "recording.started"
	EventStopping EventName = "recording.stopping"
	EventCaptured EventName = "recording.captured"
	EventFailed   EventName = "recording.failed"

	recordingHeartbeatInterval = 30 * time.Second
)

// AllEventNames is the canonical enumeration of recording protocol events,
// used by cmd/gen-protocol to generate the TypeScript protocol definitions.
var AllEventNames = []EventName{EventStarted, EventStopping, EventCaptured, EventFailed}

type EventSink interface {
	EmitRecordingEvent(EventName, db.Meeting, error) error
}

type audioRecorder interface {
	Start(context.Context) error
	Stop() error
	Done() <-chan error
	Artifacts() audioartifact.Artifacts
}

type recorderFactory func(capture.CaptureMode, string, int) audioRecorder

type Request struct {
	DeviceIdx int
	Title     string
	Mode      capture.CaptureMode
	Language  string
}

type Service struct {
	BaseDir string
	Out     io.Writer
	ErrOut  io.Writer
	Events  EventSink

	lifecycle  meetinglifecycle.Module
	processing meetingprocessing.Service
	recorder   recorderFactory
}

type meetingRecordingWorkflow struct {
	lifecycle meetinglifecycle.Module
	recorder  recorderFactory
	baseDir   string
	out       io.Writer
	errOut    io.Writer
	events    EventSink
}

func New(lifecycle meetinglifecycle.Module, processing meetingprocessing.Service) Service {
	return Service{lifecycle: lifecycle, processing: processing}
}

func (s Service) Run(req Request) error {
	return s.recordingWorkflow().run(req, s.processing)
}

func (s Service) recordingWorkflow() meetingRecordingWorkflow {
	return meetingRecordingWorkflow{
		lifecycle: s.lifecycle, recorder: s.recorder, baseDir: s.BaseDir,
		out: s.Out, errOut: s.ErrOut, events: s.Events,
	}
}

func (w meetingRecordingWorkflow) run(req Request, processing meetingprocessing.Service) error {
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
		return errors.Join(err, audioartifact.DeleteSessionUnder(w.baseDir, sessionDir))
	}
	session := w.sessionFor(meeting, audioartifact.New(sessionDir))
	return w.record(req, session, sessionDir, processing)
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

func (w meetingRecordingWorkflow) record(req Request, session recordingSession, sessionDir string, processing meetingprocessing.Service) error {
	w.printRecordingStart(req, sessionDir)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	recorder := w.newRecorder(req.Mode, sessionDir, req.DeviceIdx)
	if err := w.startCapture(ctx, recorder, session); err != nil {
		return err
	}
	waitForLiveChunks, cancelLiveChunks := w.startLiveChunkProcessing(recorder, session.meeting.ID, req.Language, processing)
	stopHeartbeat := w.startCaptureHeartbeat(session.meeting)
	if err := w.waitForStop(ctx, recorder, session); err != nil {
		stopHeartbeat()
		return err
	}
	stopHeartbeat()
	liveChunks := drainLiveChunks(waitForLiveChunks, cancelLiveChunks, processing, recorder)
	session = w.completeCapture(session, recorder)
	if err := session.capture(context.Background()); err != nil {
		return err
	}
	if liveChunks.Usable() {
		w.promoteLiveTranscript(processing, session.meeting.ID)
	}
	return session.emit(EventCaptured, nil)
}

func (w meetingRecordingWorkflow) promoteLiveTranscript(processing meetingprocessing.Service, meetingID string) {
	if err := processing.PromoteProvisionalTranscript(context.Background(), meetingID); err != nil {
		fmt.Fprintf(w.errOut, "warning: live transcript promotion skipped: %v\n", err)
	}
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
