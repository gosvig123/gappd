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
	"github.com/gappd-dev/gappd/internal/livetranscript"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
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

type Request struct {
	DeviceIdx            int
	Title                string
	Mode                 capture.CaptureMode
	Language             string
	SpeakerLabelsEnabled *bool
}

type Service struct {
	BaseDir string
	Out     io.Writer
	ErrOut  io.Writer
	Events  EventSink

	lifecycle      meetinglifecycle.Module
	liveTranscript livetranscript.Module
}

type meetingRecordingWorkflow struct {
	lifecycle      meetinglifecycle.Module
	liveTranscript livetranscript.Module
	capture        capture.Module
	baseDir        string
	out            io.Writer
	errOut         io.Writer
	events         EventSink
}

func New(lifecycle meetinglifecycle.Module, liveTranscript livetranscript.Module) Service {
	return Service{lifecycle: lifecycle, liveTranscript: liveTranscript}
}

func (s Service) Run(req Request) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	return s.run(ctx, req)
}

func (s Service) run(ctx context.Context, req Request) error {
	return s.recordingWorkflow().run(ctx, req)
}

func (s Service) recordingWorkflow() meetingRecordingWorkflow {
	return meetingRecordingWorkflow{
		lifecycle: s.lifecycle, liveTranscript: s.liveTranscript, capture: capture.New(), baseDir: s.BaseDir,
		out: s.Out, errOut: s.ErrOut, events: s.Events,
	}
}

func (w meetingRecordingWorkflow) run(ctx context.Context, req Request) error {
	if req.Title == "" {
		req.Title = time.Now().Format("2006-01-02 15:04 recording")
	}
	if req.Mode == "" {
		req.Mode = capture.ModeBoth
	}
	req.Language = meetinglang.Normalize(req.Language)
	sessionDir, err := w.createSessionDir(req.Title)
	if err != nil {
		return err
	}
	meeting, err := w.startMeeting(req.Title, sessionDir, req.Language, req.SpeakerLabelsEnabled)
	if err != nil {
		return errors.Join(err, audioartifact.DeleteSessionUnder(w.baseDir, sessionDir))
	}
	session := w.sessionFor(meeting)
	return w.record(ctx, req, session, sessionDir)
}

func (w meetingRecordingWorkflow) record(ctx context.Context, req Request, session recordingSession, sessionDir string) error {
	w.printRecordingStart(req, sessionDir)
	captureCtx, cancelCapture := context.WithCancel(ctx)
	defer cancelCapture()
	var live *livetranscript.Session
	stopHeartbeat := func() {}
	var readyEventErr, stoppingEventErr error
	observe := func(notice capture.Notice) {
		switch notice.Kind {
		case capture.NoticeReady:
			live = w.startLiveTranscript(notice.TranscriptEvents, session.meeting.ID, req.Language)
			if err := session.emit(EventStarted, nil); err != nil {
				readyEventErr = err
				cancelCapture()
				return
			}
			stopHeartbeat = w.startCaptureHeartbeat(session.meeting)
		case capture.NoticeStopRequested:
			w.printStopping()
			stoppingEventErr = session.emit(EventStopping, nil)
		}
	}
	result, captureErr := w.capture.Run(captureCtx, capture.Input{
		Mode: req.Mode, OutputDir: sessionDir, DeviceIndex: req.DeviceIdx,
	}, observe)
	stopHeartbeat()
	if result.StopWarning != nil && w.errOut != nil {
		fmt.Fprintf(w.errOut, "warning: capture helper did not exit cleanly: %v\n", result.StopWarning)
		fmt.Fprintln(w.errOut, "  requested audio was preserved")
	}
	if readyEventErr != nil {
		captureErr = errors.Join(readyEventErr, captureErr)
	}
	if captureErr != nil {
		failureErr := session.failCapture(captureErr)
		w.finishLiveTranscript(live)
		return errors.Join(failureErr, stoppingEventErr)
	}
	w.printRecorded(session.meeting.StartedAt)
	if err := session.capture(context.Background()); err != nil {
		w.finishLiveTranscript(live)
		return errors.Join(err, stoppingEventErr)
	}
	w.finishLiveTranscript(live)
	return errors.Join(session.emit(EventCaptured, nil), stoppingEventErr)
}

func (w meetingRecordingWorkflow) printRecordingStart(req Request, sessionDir string) {
	if w.events != nil {
		return
	}
	fmt.Fprintf(w.out, "● Recording to %s (press Ctrl-C to stop)\n", sessionDir)
	fmt.Fprintf(w.out, "  mode: %s, device: [%d]\n\n", req.Mode, req.DeviceIdx)
}

func (w meetingRecordingWorkflow) printStopping() {
	if w.events == nil {
		fmt.Fprintln(w.out, "\n● Stopping...")
	}
}
