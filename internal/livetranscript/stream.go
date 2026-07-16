package livetranscript

import (
	"context"
	"fmt"
	"math"

	"github.com/gappd-dev/gappd/internal/db"
)

const chunkTimeTolerance = 0.001

type sourceProgress struct {
	count int
	end   float64
}

type sourceCompletion struct {
	count int
	end   float64
}

type streamState struct {
	progress    map[Source]sourceProgress
	completed   map[Source]sourceCompletion
	expected    map[Source]bool
	hasSegments bool
	streamDone  bool
	dropped     bool
	failed      bool
	err         error
}

func newStreamState() *streamState {
	return &streamState{
		progress: map[Source]sourceProgress{}, completed: map[Source]sourceCompletion{},
		expected: map[Source]bool{},
	}
}

func (s *Session) consume(ctx context.Context) {
	state := newStreamState()
	defer func() { s.done <- state }()
	if s.input.Events == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			state.fail(ctx.Err())
			return
		case event, ok := <-s.input.Events:
			if !ok {
				return
			}
			state.accept(ctx, s.module, s.input, event)
		}
	}
}

func (s *streamState) accept(ctx context.Context, module Module, input StartInput, event Event) {
	switch event.Kind {
	case EventChunk:
		s.acceptChunk(ctx, module, input, event)
	case EventSourceComplete:
		s.acceptSourceComplete(event)
	case EventStreamComplete:
		s.acceptStreamComplete(event)
	case EventDropped:
		s.dropped = true
	default:
		s.fail(fmt.Errorf("unknown Live Transcript event %q", event.Kind))
	}
}

func (s *streamState) acceptChunk(ctx context.Context, module Module, input StartInput, event Event) {
	if s.streamDone || s.sourceDone(event.Source) {
		s.fail(fmt.Errorf("chunk arrived after completion for %s", event.Source))
		return
	}
	if err := s.advance(event); err != nil {
		s.fail(err)
		return
	}
	segments, err := module.transcribeChunk(ctx, input, event)
	if err != nil {
		s.failed = true
		return
	}
	s.insert(module, segments)
}

func (s *streamState) insert(module Module, segments []db.Segment) {
	count, err := module.insertSegments(segments)
	if count > 0 {
		s.hasSegments = true
	}
	if err != nil {
		s.err = err
	}
}

func (s *streamState) advance(event Event) error {
	progress := s.progress[event.Source]
	if math.Abs(event.CanonicalStart-progress.end) > chunkTimeTolerance {
		return fmt.Errorf("%s chunk starts at %.3fs; expected %.3fs", event.Source, event.CanonicalStart, progress.end)
	}
	s.progress[event.Source] = sourceProgress{count: progress.count + 1, end: event.CanonicalEnd}
	return nil
}

func (s *streamState) acceptSourceComplete(event Event) {
	if s.streamDone || s.sourceDone(event.Source) {
		s.fail(fmt.Errorf("duplicate or late source completion for %s", event.Source))
		return
	}
	s.completed[event.Source] = sourceCompletion{count: event.Count, end: event.CanonicalEnd}
}

func (s *streamState) acceptStreamComplete(event Event) {
	if s.streamDone {
		s.fail(fmt.Errorf("duplicate stream completion"))
		return
	}
	for _, source := range event.Sources {
		if !s.sourceDone(source) {
			s.fail(fmt.Errorf("stream completed before source %s", source))
		}
		s.expected[source] = true
	}
	s.streamDone = true
}

func (s *streamState) sourceDone(source Source) bool {
	_, ok := s.completed[source]
	return ok
}

func (s *streamState) fail(error) {
	s.failed = true
}

func (s *streamState) complete() bool {
	if s.failed || s.dropped || !s.streamDone || !s.hasSegments {
		return false
	}
	if len(s.expected) == 0 || len(s.completed) != len(s.expected) {
		return false
	}
	for source := range s.expected {
		if !s.sourceComplete(source) {
			return false
		}
	}
	return len(s.progress) == len(s.expected)
}

func (s *streamState) sourceComplete(source Source) bool {
	progress, seen := s.progress[source]
	terminal, done := s.completed[source]
	return seen && done && progress.count == terminal.count &&
		math.Abs(progress.end-terminal.end) <= chunkTimeTolerance
}
