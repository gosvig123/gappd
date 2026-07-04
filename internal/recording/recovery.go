package recording

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
)

const (
	StaleRecordingTimeout = 5 * time.Minute
	staleRecoveryLimit    = 10
	staleNoAudioMessage   = "Recording was interrupted before audio was saved. Start a new recording."
)

type RecoverStaleOptions struct {
	Now                       time.Time
	Timeout                   time.Duration
	Limit                     int
	SuppressProcessingFailure bool
}

func (s Service) RecoverStale(ctx context.Context, opts RecoverStaleOptions) (int, error) {
	if s.Store == nil {
		return 0, fmt.Errorf("recover stale recordings: store is required")
	}
	opts = opts.withDefaults()
	cutoff := opts.Now.Add(-opts.Timeout).UTC().Format(time.RFC3339)
	meetings, err := s.Store.ListStaleRecordingMeetings(cutoff, opts.Limit)
	if err != nil {
		return 0, err
	}
	return s.recoverStaleMeetings(ctx, meetings, cutoff, opts)
}

func (opts RecoverStaleOptions) withDefaults() RecoverStaleOptions {
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

func (s Service) recoverStaleMeetings(ctx context.Context, meetings []db.Meeting, cutoff string, opts RecoverStaleOptions) (int, error) {
	recovered := 0
	for i := range meetings {
		ok, err := s.recoverStaleMeeting(ctx, &meetings[i], cutoff, opts)
		if err != nil {
			return recovered, err
		}
		if ok {
			recovered++
		}
	}
	return recovered, nil
}

func (s Service) recoverStaleMeeting(ctx context.Context, meeting *db.Meeting, cutoff string, opts RecoverStaleOptions) (bool, error) {
	if !staleMeetingHasAudio(meeting) {
		return s.failStaleRecording(meeting, cutoff, opts.Now)
	}
	if ok, err := s.claimStaleRecording(meeting, cutoff, opts.Now); !ok || err != nil {
		return ok, err
	}
	session := s.sessionFor(meeting, audioartifact.New(*meeting.AudioPath))
	if err := s.emit(EventProcessing, *meeting, nil); err != nil {
		return true, err
	}
	err := s.processing().processCaptured(ctx, session, meeting.Language)
	return s.finishStaleProcessing(err, opts)
}

func (s Service) finishStaleProcessing(err error, opts RecoverStaleOptions) (bool, error) {
	if err == nil || !opts.SuppressProcessingFailure {
		return true, err
	}
	if s.ErrOut != nil {
		fmt.Fprintf(s.ErrOut, "warning: stale recording post-processing failed: %v\n", err)
	}
	return true, nil
}

func (s Service) claimStaleRecording(meeting *db.Meeting, cutoff string, now time.Time) (bool, error) {
	endedAt := now.UTC().Format(time.RFC3339)
	ok, err := s.Store.ClaimStaleRecordingForProcessing(meeting.ID, cutoff, endedAt)
	if !ok || err != nil {
		return ok, err
	}
	lifecycleFor(meeting).captured(endedAt)
	return true, nil
}

func (s Service) failStaleRecording(meeting *db.Meeting, cutoff string, now time.Time) (bool, error) {
	endedAt := now.UTC().Format(time.RFC3339)
	failureErr := errors.New(staleNoAudioMessage)
	ok, err := s.Store.FailStaleRecording(meeting.ID, cutoff, endedAt, failureErr.Error())
	if !ok || err != nil {
		return ok, err
	}
	lifecycleFor(meeting).captureFailed(endedAt, failureErr)
	if err := s.emit(EventFailed, *meeting, failureErr); err != nil {
		return true, err
	}
	return true, nil
}

func staleMeetingHasAudio(meeting *db.Meeting) bool {
	return meeting.AudioPath != nil && audioartifact.New(*meeting.AudioPath).HasAudio()
}
