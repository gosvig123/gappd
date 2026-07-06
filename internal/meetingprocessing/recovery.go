package meetingprocessing

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

const (
	StaleRecordingTimeout = 5 * time.Minute
	staleRecoveryLimit    = 10
	StaleNoAudioMessage   = "Recording was interrupted before audio was saved. Start a new recording."
)

type RecoveryStore interface {
	ListStaleRecordingMeetings(string, int) ([]db.Meeting, error)
	ClaimStaleRecordingForProcessing(*db.Meeting, string, string) (bool, error)
	FailStaleRecording(*db.Meeting, string, string, error) (bool, error)
}

type RecoveryOptions struct {
	Now                       time.Time
	Timeout                   time.Duration
	Limit                     int
	SuppressProcessingFailure bool
	ErrOut                    io.Writer
}

type Recovery struct {
	Store     RecoveryStore
	Processor CapturedProcessor
	Events    EventSink
}

func (r Recovery) RecoverStale(ctx context.Context, opts RecoveryOptions) (int, error) {
	if r.Store == nil || r.Processor == nil {
		return 0, fmt.Errorf("recover stale recordings: store and processor are required")
	}
	opts = opts.withDefaults()
	cutoff := opts.Now.Add(-opts.Timeout).UTC().Format(time.RFC3339)
	meetings, err := r.Store.ListStaleRecordingMeetings(cutoff, opts.Limit)
	if err != nil {
		return 0, err
	}
	return r.recoverMeetings(ctx, meetings, cutoff, opts)
}

func (opts RecoveryOptions) withDefaults() RecoveryOptions {
	if opts.Now.IsZero() {
		opts.Now = time.Now().UTC()
	}
	if opts.Timeout == 0 {
		opts.Timeout = StaleRecordingTimeout
	}
	if opts.Limit == 0 {
		opts.Limit = staleRecoveryLimit
	}
	return opts
}

func (r Recovery) recoverMeetings(ctx context.Context, meetings []db.Meeting, cutoff string, opts RecoveryOptions) (int, error) {
	recovered := 0
	for i := range meetings {
		ok, err := r.recoverMeeting(ctx, &meetings[i], cutoff, opts)
		if err != nil {
			return recovered, err
		}
		if ok {
			recovered++
		}
	}
	return recovered, nil
}

func (r Recovery) recoverMeeting(ctx context.Context, meeting *db.Meeting, cutoff string, opts RecoveryOptions) (bool, error) {
	if !staleMeetingHasAudio(meeting) {
		return r.failStaleRecording(meeting, cutoff, opts.Now)
	}
	if ok, err := r.claimStaleRecording(meeting, cutoff, opts.Now); !ok || err != nil {
		return ok, err
	}
	err := r.processClaimed(ctx, meeting)
	return finishStaleProcessing(err, opts)
}

func (r Recovery) claimStaleRecording(meeting *db.Meeting, cutoff string, now time.Time) (bool, error) {
	endedAt := now.UTC().Format(time.RFC3339)
	return r.Store.ClaimStaleRecordingForProcessing(meeting, cutoff, endedAt)
}

func (r Recovery) processClaimed(ctx context.Context, meeting *db.Meeting) error {
	return r.Processor.ProcessCaptured(ctx, CapturedRequest{MeetingID: meeting.ID, AudioDir: *meeting.AudioPath, Language: meeting.Language})
}

func finishStaleProcessing(err error, opts RecoveryOptions) (bool, error) {
	if err == nil || !opts.SuppressProcessingFailure {
		return true, err
	}
	if opts.ErrOut != nil {
		fmt.Fprintf(opts.ErrOut, "warning: stale recording post-processing failed: %v\n", err)
	}
	return true, nil
}

func (r Recovery) failStaleRecording(meeting *db.Meeting, cutoff string, now time.Time) (bool, error) {
	endedAt := now.UTC().Format(time.RFC3339)
	failureErr := errors.New(StaleNoAudioMessage)
	ok, err := r.Store.FailStaleRecording(meeting, cutoff, endedAt, failureErr)
	if !ok || err != nil {
		return ok, err
	}
	return true, r.emitFailed(meeting, failureErr)
}

func (r Recovery) emitFailed(meeting *db.Meeting, failure error) error {
	if r.Events == nil {
		return nil
	}
	return r.Events.EmitProcessingEvent(Event{Name: EventFailed, Meeting: *meeting, Err: failure})
}

func staleMeetingHasAudio(meeting *db.Meeting) bool {
	return meeting.AudioPath != nil && audioartifact.New(*meeting.AudioPath).HasAudio()
}
