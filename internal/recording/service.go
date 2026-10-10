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
	"github.com/gappd-dev/gappd/internal/video"
)

type EventName string

const (
	EventStarted        EventName = "recording.started"
	EventStopping       EventName = "recording.stopping"
	EventCaptured       EventName = "recording.captured"
	EventFailed         EventName = "recording.failed"
	EventVideoCancelled EventName = "recording.videoCancelled"
	EventVideoSkipped   EventName = "recording.videoSkipped"
	EventVideoStarted   EventName = "recording.videoStarted"
	EventVideoEnded     EventName = "recording.videoEnded"
	EventVideoFinalized EventName = "recording.videoFinalized"
	EventVideoFailed    EventName = "recording.videoFailed"

	recordingHeartbeatInterval = 30 * time.Second
)

// AllEventNames is the canonical enumeration of recording protocol events,
// used by cmd/gen-protocol to generate the TypeScript protocol definitions.
var AllEventNames = []EventName{EventStarted, EventStopping, EventCaptured, EventFailed, EventVideoCancelled, EventVideoSkipped, EventVideoStarted, EventVideoEnded, EventVideoFinalized, EventVideoFailed}

type EventSink interface {
	EmitRecordingEvent(EventName, db.Meeting, error) error
}

type Request struct {
	DeviceIdx            int
	Title                string
	Mode                 capture.CaptureMode
	Language             string
	SpeakerLabelsEnabled *bool
	ScreenVideoEnabled   bool
}

type Service struct {
	Store   *db.DB
	BaseDir string
	Out     io.Writer
	ErrOut  io.Writer
	Events  EventSink

	lifecycle      meetinglifecycle.Module
	liveTranscript livetranscript.Module
}

type meetingRecordingWorkflow struct {
	store          *db.DB
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
		lifecycle: s.lifecycle, liveTranscript: s.liveTranscript, capture: capture.New(), baseDir: s.BaseDir, store: s.Store,
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
	defer w.removeLiveTranscriptChunks(sessionDir) // Runs after the Live Transcript drains; processing reads mic.wav and system.wav.
	captureCtx, cancelCapture := context.WithCancel(ctx)
	defer cancelCapture()
	var live *livetranscript.Session
	stopHeartbeat := func() {}
	var readyEventErr, stoppingEventErr error
	var videoDone <-chan struct{}
	if req.ScreenVideoEnabled && w.store != nil {
		done := make(chan struct{})
		videoDone = done
		go func() {
			defer close(done)
			w.runVideo(captureCtx, session, sessionDir)
		}()
	}
	observe := func(notice capture.Notice) {
		switch notice.Kind {
		case capture.NoticeAudioStart:
			if w.store != nil {
				started := notice.AudioStart
				if err := w.store.UpdateAudioStart(session.meeting.ID, started.Source, started.HostSeconds); err != nil {
					if w.errOut != nil {
						fmt.Fprintf(w.errOut, "warning: save %s start time: %v\n", started.Source, err)
					}
				} else {
					_ = w.store.UpdateVideoInterval(session.meeting.ID)
				}
			}
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
	cancelCapture() // An unexpected audio exit must not leave the picker or video helper running.
	stopHeartbeat()
	if videoDone != nil {
		<-videoDone
	}
	if live != nil {
		live.Drain(context.Background())
	}
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

// runVideo never changes audio capture state. All video transitions remain Meeting-owned.
func (w meetingRecordingWorkflow) runVideo(ctx context.Context, session recordingSession, dir string) {
	if err := w.store.UpdateMeetingVideo(session.meeting.ID, db.VideoUpdate{State: "selecting"}); err != nil {
		if w.errOut != nil {
			fmt.Fprintf(w.errOut, "warning: save Screen video selection state: %v\n", err)
		}
		return
	}
	finalized := false
	settled := false
	endedEarly := false
	endReason := ""
	report := func(name EventName, update db.VideoUpdate, cause error) {
		if err := w.store.UpdateMeetingVideo(session.meeting.ID, update); err != nil {
			if w.errOut != nil {
				fmt.Fprintf(w.errOut, "warning: save Screen video state: %v\n", err)
			}
			return
		}
		_ = w.store.UpdateVideoInterval(session.meeting.ID)
		meeting, err := w.store.GetMeeting(session.meeting.ID)
		if err == nil && session.events != nil {
			_ = session.events.EmitRecordingEvent(name, *meeting, cause)
		}
	}
	err := video.Run(ctx, dir, func(e video.Event) {
		update := db.VideoUpdate{Message: stringPointer(e.Reason)}
		switch e.Type {
		case "video_cancelled":
			settled = true
			update.State = "cancelled"
			report(EventVideoCancelled, update, nil)
		case "video_skipped":
			settled = true
			update.State = "skipped"
			report(EventVideoSkipped, update, nil)
		case "video_started":
			update.State = "recording"
			update.SourceType = &e.SourceType
			update.OriginHostSec = &e.HostSeconds
			partial := db.VideoPartialFile
			update.File = &partial
			report(EventVideoStarted, update, nil)
		case "video_ended":
			endedEarly = true
			endReason = e.Reason
			update.State = "ended"
			report(EventVideoEnded, update, nil)
		case "video_finalized":
			finalized = true
			update.State = "ready"
			if endedEarly {
				update.State = "ended"
				update.Message = stringPointer(endReason)
			}
			final := db.VideoFile
			update.File = &final
			update.EndHostSec = &e.HostSeconds
			report(EventVideoFinalized, update, nil)
		case "video_failed":
			settled = true
			update.State = "failed"
			report(EventVideoFailed, update, errors.New(e.Reason))
		}
	})
	if !finalized && !settled {
		message := "Screen video was interrupted; recovery will check the unfinished movie."
		if err != nil {
			message = err.Error()
		}
		update := db.VideoUpdate{State: db.VideoStateFailed, Message: &message}
		if _, statErr := video.ManagedFile(dir, db.VideoPartialFile); statErr == nil {
			partial := db.VideoPartialFile
			update.State = db.VideoStateUnfinished
			update.File = &partial
		}
		report(EventVideoFailed, update, errors.New(message))
	} else if settled && err != nil {
		if _, statErr := video.ManagedFile(dir, db.VideoPartialFile); statErr == nil {
			message := err.Error()
			partial := db.VideoPartialFile
			report(EventVideoFailed, db.VideoUpdate{State: "unfinished", File: &partial, Message: &message}, err)
		}
	}
}

func stringPointer(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
