package meetinglifecycle

import (
	"context"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func (w Module) CommitLiveTranscript(ctx context.Context, id, transcript string, segments []db.Segment, at time.Time) (Result, error) {
	meeting, err := w.store.GetMeeting(id)
	if err != nil {
		return Result{}, err
	}
	if meeting.Transcript != nil && sameText(meeting.Transcript, transcript) {
		return Result{Meeting: meeting}, nil
	}
	if err := requireLiveTranscriptPending(meeting); err != nil {
		return Result{Meeting: meeting}, err
	}
	applied, err := w.store.CommitLiveTranscript(ctx, id, transcript, segments, at)
	if err != nil || !applied {
		return Result{Meeting: meeting, Applied: applied}, err
	}
	meeting.Transcript = &transcript
	meeting.TranscriptRevision++
	meeting.ProcessingStatusUpdatedAt = timestamp(at)
	return Result{Meeting: meeting, Applied: true}, nil
}

func (w Module) DiscardLiveTranscript(ctx context.Context, id string, at time.Time) (Result, error) {
	meeting, err := w.store.GetMeeting(id)
	if err != nil {
		return Result{}, err
	}
	if err := requireLiveTranscriptPending(meeting); err != nil {
		return Result{Meeting: meeting}, err
	}
	applied, err := w.store.DiscardLiveTranscript(ctx, id, at)
	if err != nil || !applied {
		return Result{Meeting: meeting, Applied: applied}, err
	}
	meeting.TranscriptRevision++
	meeting.ProcessingStatusUpdatedAt = timestamp(at)
	return Result{Meeting: meeting, Applied: true}, nil
}

func requireLiveTranscriptPending(meeting *db.Meeting) error {
	if meeting.CaptureStatus != db.CaptureStatusCaptured || meeting.ProcessingStatus != db.ProcessingStatusPending {
		return fmt.Errorf("Live Transcript requires captured meeting with pending processing")
	}
	if meeting.Transcript != nil {
		return fmt.Errorf("Live Transcript already committed")
	}
	return nil
}
