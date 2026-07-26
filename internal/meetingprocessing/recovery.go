package meetingprocessing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

const (
	StaleRecordingTimeout = 5 * time.Minute
	staleRecoveryLimit    = 10
	StaleNoAudioMessage   = "Recording was interrupted before audio was saved. Start a new recording."
)

type RecoveryStore interface {
	ListStaleRecordingMeetings(string, int) ([]db.Meeting, error)
}

type RecoveryOptions struct {
	Now     time.Time
	Timeout time.Duration
	Limit   int
}

type Recovery struct {
	Store     RecoveryStore
	Lifecycle Lifecycle
}

func (r Recovery) RecoverStale(ctx context.Context, opts RecoveryOptions) (int, error) {
	if r.Store == nil || r.lifecycle() == nil {
		return 0, fmt.Errorf("recover stale recordings: store and lifecycle are required")
	}
	opts = opts.withDefaults()
	cutoff := opts.Now.Add(-opts.Timeout).UTC().Format(time.RFC3339)
	meetings, err := r.Store.ListStaleRecordingMeetings(cutoff, opts.Limit)
	if err != nil {
		return 0, err
	}
	return r.recoverMeetings(ctx, meetings, cutoff, opts)
}

func (r Recovery) lifecycle() Lifecycle {
	if r.Lifecycle != nil {
		return r.Lifecycle
	}
	store, ok := r.Store.(*db.DB)
	if !ok {
		return nil
	}
	return meetinglifecycle.New(store)
}

func parseTime(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
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
		return r.failStaleRecording(ctx, meeting, cutoff, opts.Now)
	}
	if ok, err := r.claimStaleRecording(ctx, meeting, cutoff, opts.Now); !ok || err != nil {
		return ok, err
	}
	return true, nil
}

func (r Recovery) claimStaleRecording(ctx context.Context, meeting *db.Meeting, cutoff string, now time.Time) (bool, error) {
	transition := meetinglifecycle.StaleCaptured{Cutoff: parseTime(cutoff), At: now}
	result, err := r.lifecycle().Transition(ctx, meeting.ID, transition)
	if err == nil && result.Applied {
		*meeting = *result.Meeting
	}
	return result.Applied, err
}

func (r Recovery) failStaleRecording(ctx context.Context, meeting *db.Meeting, cutoff string, now time.Time) (bool, error) {
	failureErr := errors.New(StaleNoAudioMessage)
	transition := meetinglifecycle.StaleCaptureFailed{Cutoff: parseTime(cutoff), At: now, Cause: failureErr}
	result, err := r.lifecycle().Transition(ctx, meeting.ID, transition)
	if !result.Applied || err != nil {
		return result.Applied, err
	}
	*meeting = *result.Meeting
	return true, nil
}

func staleMeetingHasAudio(meeting *db.Meeting) bool {
	return meeting.AudioPath != nil && audioartifact.New(*meeting.AudioPath).HasAudio()
}
