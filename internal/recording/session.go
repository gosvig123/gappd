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

func (w meetingRecordingWorkflow) sessionFor(meeting *db.Meeting, artifacts audioartifact.Artifacts) recordingSession {
	return recordingSession{store: w.meetings(), events: w.events, meeting: meeting, artifacts: artifacts}
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
	if err := r.store.MarkCaptureFailed(r.meeting, nowUTC(), captureErr); err != nil {
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

func (r recordingSession) finish(processing meetingProcessing, req processingRequest) error {
	if err := r.requireAudio(); err != nil {
		return err
	}
	return processing.processAfterCapture(r, req)
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
