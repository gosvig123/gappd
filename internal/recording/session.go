package recording

import (
	"context"
	"errors"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

type recordingSession struct {
	lifecycle meetinglifecycle.Module
	events    EventSink
	meeting   *db.Meeting
}

func (w meetingRecordingWorkflow) sessionFor(meeting *db.Meeting) recordingSession {
	return recordingSession{lifecycle: w.lifecycle, events: w.events, meeting: meeting}
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
		return errors.Join(captureErr, err)
	}
	if err := r.emit(EventFailed, captureErr); err != nil {
		return errors.Join(captureErr, err)
	}
	return captureErr
}

func (r recordingSession) capture(ctx context.Context) error {
	return r.apply(ctx, meetinglifecycle.Captured{At: time.Now()})
}

func (r recordingSession) apply(ctx context.Context, transition meetinglifecycle.Transition) error {
	result, err := r.lifecycle.Transition(ctx, r.meeting.ID, transition)
	if err != nil {
		return err
	}
	*r.meeting = *result.Meeting
	return nil
}
