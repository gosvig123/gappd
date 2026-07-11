package recording

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
)

type processingRequest struct {
	language          string
	suppressFailure   bool
	audioDir          string
	reuseLiveSegments bool
}

type recordingSession struct {
	lifecycle meetinglifecycle.Module
	events    EventSink
	meeting   *db.Meeting
	artifacts audioartifact.Artifacts
}

func (w meetingRecordingWorkflow) sessionFor(meeting *db.Meeting, artifacts audioartifact.Artifacts) recordingSession {
	return recordingSession{lifecycle: w.lifecycle, events: w.events, meeting: meeting, artifacts: artifacts}
}

func (r recordingSession) withArtifacts(artifacts audioartifact.Artifacts) recordingSession {
	r.artifacts = artifacts
	return r
}

func (r recordingSession) emit(name EventName, err error) error {
	if r.events == nil {
		return nil
	}
	return r.events.EmitRecordingEvent(name, *r.meeting, err)
}

func (r recordingSession) failCapture(captureErr error) error {
	transition := meetinglifecycle.CaptureFailed{At: time.Now(), Cause: captureErr}
	if err := r.apply(context.Background(), transition); err != nil {
		return err
	}
	if err := r.emit(EventFailed, captureErr); err != nil {
		return err
	}
	return captureErr
}

func (r recordingSession) failUnexpectedCaptureStop(err error) error {
	unexpectedErr := fmt.Errorf("capture stopped unexpectedly")
	if err != nil {
		unexpectedErr = fmt.Errorf("capture stopped unexpectedly: %w", err)
	}
	if failErr := r.failCapture(unexpectedErr); failErr != nil {
		return failErr
	}
	return unexpectedErr
}

func (r recordingSession) finish(ctx context.Context, processing meetingprocessing.Service, req processingRequest) error {
	if err := r.requireAudio(); err != nil {
		return err
	}
	if err := r.apply(ctx, meetinglifecycle.Captured{At: time.Now()}); err != nil {
		return err
	}
	err := processing.ProcessCaptured(ctx, meetingprocessing.CapturedRequest{MeetingID: r.meeting.ID, AudioDir: r.audioDir(req), Language: req.language, ReuseLiveSegments: req.reuseLiveSegments})
	if err != nil && req.suppressFailure {
		return nil
	}
	return err
}

func (r recordingSession) apply(ctx context.Context, transition meetinglifecycle.Transition) error {
	result, err := r.lifecycle.Transition(ctx, r.meeting.ID, transition)
	if err != nil {
		return err
	}
	*r.meeting = *result.Meeting
	return nil
}

func (r recordingSession) audioDir(req processingRequest) string {
	if r.artifacts.MicPath() != "" {
		return filepath.Dir(r.artifacts.MicPath())
	}
	return req.audioDir
}

func (r recordingSession) requireAudio() error {
	if r.artifacts.HasAudio() {
		return nil
	}
	captureErr := fmt.Errorf("no audio captured")
	if err := r.failCapture(captureErr); err != nil {
		return err
	}
	return captureErr
}
