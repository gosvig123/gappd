package recording

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

const (
	liveTranscriptInterval = 2 * time.Second
	liveChunkDuration      = 5 * time.Second
	chunkDirName           = "chunks"
	chunkExt               = ".wav"
	minWAVSize             = 44
)

type audioSource struct {
	path    string
	speaker string
}

type liveTranscriptSession struct {
	seen     map[string]bool
	segments []db.Segment
}

type liveChunk struct {
	path    string
	speaker string
	start   float64
}

func (s Service) startLiveTranscript(ctx context.Context, meeting *db.Meeting, recorder audioRecorder, req Request) func() {
	if !req.LiveTranscript {
		return noop
	}
	liveCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	session := &liveTranscriptSession{seen: map[string]bool{}}
	go s.runLiveTranscript(liveCtx, done, session, meeting, recorder, req)
	return func() { cancel(); <-done }
}

func (s Service) runLiveTranscript(ctx context.Context, done chan<- struct{}, session *liveTranscriptSession, meeting *db.Meeting, recorder audioRecorder, req Request) {
	defer close(done)
	timer := time.NewTimer(liveTranscriptInterval)
	defer timer.Stop()
	for {
		select {
		case <-timer.C:
			s.updateLiveTranscript(ctx, session, meeting, recorder, req)
			timer.Reset(liveTranscriptInterval)
		case <-ctx.Done():
			return
		}
	}
}

func (s Service) updateLiveTranscript(ctx context.Context, session *liveTranscriptSession, meeting *db.Meeting, recorder audioRecorder, req Request) {
	chunks, err := pendingLiveChunks(recorder, session.seen)
	if err != nil {
		s.warnLiveTranscript(err)
		return
	}
	for _, chunk := range chunks {
		s.transcribeLiveChunk(ctx, session, chunk, meeting.ID, req)
	}
	if len(chunks) > 0 {
		s.saveLiveSegments(meeting, session.segments)
	}
}

func (s Service) transcribeLiveChunk(ctx context.Context, session *liveTranscriptSession, chunk liveChunk, meetingID string, req Request) {
	window, err := liveChunkWindow(chunk)
	if err != nil {
		s.warnLiveTranscript(err)
		return
	}
	defer window.cleanup()
	segments, err := s.transcribeAs(ctx, window.path, req.ModelPath, req.DefaultModelPath, chunk.speaker)
	if err != nil {
		s.warnLiveTranscript(err)
		return
	}
	dbSegments := toDBSegments(meetingID, segments)
	offsetSegments(dbSegments, window.start)
	session.segments = replaceLiveWindow(session.segments, chunk.speaker, window.start)
	session.segments = append(session.segments, dbSegments...)
	session.seen[chunk.path] = true
}

func chunkDir(path string) string {
	return filepath.Join(filepath.Dir(path), chunkDirName)
}

func chunkPrefix(path string) string {
	return strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
}

func audioSources(recorder audioRecorder) []audioSource {
	return []audioSource{{recorder.MicPath(), "You"}, {recorder.SystemPath(), "Other"}}
}

func (s Service) saveLiveSegments(meeting *db.Meeting, segments []db.Segment) {
	if len(segments) == 0 {
		return
	}
	sortSegmentsChronologically(segments)
	if err := s.saveLiveTranscript(meeting, FormatTranscript(segments)); err != nil {
		s.warnLiveTranscript(err)
	}
}

func (s Service) saveLiveTranscript(meeting *db.Meeting, transcript string) error {
	meeting.Transcript = &transcript
	if err := s.meetings().UpdateTranscript(meeting.ID, transcript); err != nil {
		return fmt.Errorf("save live transcript: %w", err)
	}
	return nil
}

func (s Service) warnLiveTranscript(err error) {
	if s.ErrOut != nil && !errors.Is(err, errMissingAudio) {
		fmt.Fprintf(s.ErrOut, "warning: live transcription skipped: %v\n", err)
	}
}
