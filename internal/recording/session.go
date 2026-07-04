package recording

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

type recordingSession struct {
	store     meetingStore
	out       io.Writer
	errOut    io.Writer
	events    EventSink
	meeting   *db.Meeting
	artifacts audioartifact.Artifacts
}

func (s Service) sessionFor(meeting *db.Meeting, artifacts audioartifact.Artifacts) recordingSession {
	return recordingSession{
		store: s.meetings(), out: s.Out, errOut: s.ErrOut,
		events: s.Events, meeting: meeting, artifacts: artifacts,
	}
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
	return r.emit(EventFailed, captureErr)
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
	if err := r.markCaptured(nowUTC()); err != nil {
		return err
	}
	return r.process(req, processing)
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

func (r recordingSession) process(req Request, processing meetingProcessing) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	err := processing.processCaptured(ctx, r)
	if err != nil && req.SuppressProcessingFailure {
		fmt.Fprintf(r.errOut, "warning: post-processing failed after capture: %v\n", err)
		return nil
	}
	return err
}

func (r recordingSession) markCaptured(at string) error {
	lifecycleFor(r.meeting).captured(at)
	if err := r.store.UpdateMeeting(r.meeting); err != nil {
		return fmt.Errorf("mark meeting captured: %w", err)
	}
	return r.emit(EventProcessing, nil)
}

func (r recordingSession) saveProcessingFailure(origErr error) error {
	now := nowUTC()
	lifecycleFor(r.meeting).processingFailed(now, origErr)
	updateErr := r.store.UpdateMeeting(r.meeting)
	if updateErr != nil {
		return errors.Join(fmt.Errorf("transcription failed: %w", origErr), fmt.Errorf("save partial meeting: %w", updateErr))
	}
	return r.emitProcessingFailure(origErr)
}

func (r recordingSession) emitProcessingFailure(origErr error) error {
	if r.meeting.AudioPath != nil && r.events == nil {
		fmt.Fprintf(r.out, "  session saved (audio may be incomplete — check %s)\n", *r.meeting.AudioPath)
	}
	if err := r.emit(EventFailed, origErr); err != nil {
		return err
	}
	return fmt.Errorf("transcription failed: %w", origErr)
}

func (r recordingSession) markProcessing() error {
	lifecycleFor(r.meeting).processingStarted(nowUTC())
	if err := r.store.UpdateMeeting(r.meeting); err != nil {
		return fmt.Errorf("mark meeting processing: %w", err)
	}
	return nil
}

func (r recordingSession) saveTranscript(transcript string) error {
	lifecycleFor(r.meeting).transcriptSaved(transcript, nowUTC())
	if err := r.store.UpdateMeeting(r.meeting); err != nil {
		return fmt.Errorf("save transcript: %w", err)
	}
	return r.emit(EventProcessing, nil)
}

func (r recordingSession) saveEnhancement(title, transcript, summary, extractionJSON string) error {
	lifecycleFor(r.meeting).processingCompleted(title, transcript, summary, extractionJSON, nowUTC())
	if err := r.store.UpdateMeeting(r.meeting); err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}
	return r.emit(EventCompleted, nil)
}

func (r recordingSession) saveEnhanceFailure(transcript string, err error) error {
	lifecycleFor(r.meeting).enhancementFailed(transcript, nowUTC(), err)
	updateErr := r.store.UpdateMeeting(r.meeting)
	if updateErr != nil {
		return errors.Join(fmt.Errorf("enhance failed: %w", err), fmt.Errorf("save transcript: %w", updateErr))
	}
	if emitErr := r.emit(EventFailed, err); emitErr != nil {
		return emitErr
	}
	return fmt.Errorf("enhance failed (transcript saved): %w", err)
}
