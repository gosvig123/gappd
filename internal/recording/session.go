package recording

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

type recordingSession struct {
	store     meetingStore
	events    EventSink
	meeting   *db.Meeting
	artifacts audioartifact.Artifacts
}

func (s Service) sessionFor(meeting *db.Meeting, artifacts audioartifact.Artifacts) recordingSession {
	return recordingSession{store: s.meetings(), events: s.Events, meeting: meeting, artifacts: artifacts}
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
	now := nowUTC()
	lifecycleFor(r.meeting).captureFailed(now, captureErr)
	if err := r.store.UpdateMeeting(r.meeting); err != nil {
		return fmt.Errorf("mark meeting capture failed: %w", err)
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

func (r recordingSession) finish(req Request, processing meetingProcessing) error {
	if err := r.requireAudio(); err != nil {
		return err
	}
	return processing.processAfterCapture(req, r)
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
