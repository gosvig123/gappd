package livetranscript

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type Outcome string

const (
	OutcomeComplete      Outcome = "complete"
	OutcomeRebuildQueued Outcome = "rebuild_queued"

	defaultDrainTimeout = 30 * time.Second
)

type Transcriber interface {
	Transcribe(context.Context, string, string) ([]transcribe.Segment, error)
}

type TranscriberFunc func(context.Context, string, string) ([]transcribe.Segment, error)

func (f TranscriberFunc) Transcribe(ctx context.Context, path, language string) ([]transcribe.Segment, error) {
	return f(ctx, path, language)
}

type Module struct {
	store        *db.DB
	lifecycle    meetinglifecycle.Module
	transcriber  Transcriber
	drainTimeout time.Duration
}

type StartInput struct {
	MeetingID string
	Language  string
	Events    <-chan Event
}

type Session struct {
	module Module
	input  StartInput
	cancel context.CancelFunc
	done   chan *streamState
	mu     sync.Mutex
	result Outcome
	err    error
	closed bool
}

func New(store *db.DB, lifecycle meetinglifecycle.Module, transcriber Transcriber) Module {
	return Module{store: store, lifecycle: lifecycle, transcriber: transcriber, drainTimeout: defaultDrainTimeout}
}

func (m Module) Start(ctx context.Context, input StartInput) *Session {
	workCtx, cancel := context.WithCancel(ctx)
	session := &Session{module: m, input: input, cancel: cancel, done: make(chan *streamState, 1)}
	go session.consume(workCtx)
	return session
}

func (s *Session) Finish(ctx context.Context) (Outcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return s.result, s.err
	}
	s.result, s.err = s.finish(ctx)
	s.closed = true
	return s.result, s.err
}

func (s *Session) finish(ctx context.Context) (Outcome, error) {
	defer s.cancel()
	state, err := s.await(ctx)
	if err != nil {
		discardErr := s.module.discard(context.Background(), s.input.MeetingID)
		return "", errors.Join(err, discardErr)
	}
	return s.module.finalize(ctx, s.input.MeetingID, state)
}

func (s *Session) await(ctx context.Context) (*streamState, error) {
	timer := time.NewTimer(s.module.drainTimeout)
	defer timer.Stop()
	select {
	case state := <-s.done:
		return state, nil
	case <-timer.C:
		return s.cancelAndWait(fmt.Errorf("Live Transcript drain timed out")), nil
	case <-ctx.Done():
		return s.cancelAndWait(ctx.Err()), ctx.Err()
	}
}

func (s *Session) cancelAndWait(cause error) *streamState {
	s.cancel()
	state := <-s.done
	state.fail(cause)
	return state
}

func (m Module) finalize(ctx context.Context, meetingID string, state *streamState) (Outcome, error) {
	if state.err != nil {
		discardErr := m.discard(ctx, meetingID)
		return "", errors.Join(state.err, discardErr)
	}
	if !state.complete() {
		return OutcomeRebuildQueued, m.discard(ctx, meetingID)
	}
	return m.commit(ctx, meetingID)
}

func (m Module) commit(ctx context.Context, meetingID string) (Outcome, error) {
	segments, err := m.store.GetSegments(meetingID)
	if err != nil {
		return "", fmt.Errorf("load Live Transcript segments: %w", err)
	}
	result, err := m.lifecycle.CommitLiveTranscript(ctx, meetingID, formatTranscript(segments), segments, time.Now())
	if err != nil {
		return "", m.commitFailure(ctx, meetingID, err)
	}
	if !result.Applied && result.Meeting.Transcript == nil {
		return "", m.commitFailure(ctx, meetingID, fmt.Errorf("meeting state rejected commit"))
	}
	return OutcomeComplete, nil
}

func (m Module) commitFailure(ctx context.Context, meetingID string, cause error) error {
	return errors.Join(fmt.Errorf("commit Live Transcript: %w", cause), m.discard(ctx, meetingID))
}

func (m Module) discard(ctx context.Context, meetingID string) error {
	_, err := m.lifecycle.DiscardLiveTranscript(ctx, meetingID, time.Now())
	if err != nil {
		return fmt.Errorf("discard incomplete Live Transcript: %w", err)
	}
	return nil
}
