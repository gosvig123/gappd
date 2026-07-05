package recording

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type fakeEnhancer struct {
	title   string
	summary string
	err     error
}

func (e fakeEnhancer) RunWithOptions(context.Context, string, ai.RunOptions) (*ai.Extraction, string, error) {
	return &ai.Extraction{Title: e.title}, e.summary, e.err
}

func (e fakeEnhancer) RefineNotes(context.Context, *ai.Extraction, string, string, string) (string, error) {
	return e.summary, e.err
}

type fakeStore struct {
	meeting  *db.Meeting
	segments []db.Segment
}

func newFakeStore() *fakeStore {
	return &fakeStore{}
}

func (s *fakeStore) CreateMeeting(meeting *db.Meeting) error {
	meeting.ID = "meeting-full-lifecycle"
	copy := *meeting
	s.meeting = &copy
	return nil
}

func (s *fakeStore) UpdateMeeting(meeting *db.Meeting) error {
	copy := *meeting
	s.meeting = &copy
	return nil
}

func (s *fakeStore) MarkCaptureFailed(meeting *db.Meeting, at string, failure error) error {
	db.LifecycleFor(meeting).CaptureFailed(at, failure)
	return s.UpdateMeeting(meeting)
}

func (s *fakeStore) MarkCaptured(meeting *db.Meeting, at string) error {
	db.LifecycleFor(meeting).Captured(at)
	return s.UpdateMeeting(meeting)
}

func (s *fakeStore) MarkProcessingStarted(meeting *db.Meeting, at string) error {
	db.LifecycleFor(meeting).ProcessingStarted(at)
	return s.UpdateMeeting(meeting)
}

func (s *fakeStore) MarkProcessingFailed(meeting *db.Meeting, at string, failure error) error {
	db.LifecycleFor(meeting).ProcessingFailed(at, failure)
	return s.UpdateMeeting(meeting)
}

func (s *fakeStore) SaveTranscript(meeting *db.Meeting, transcript, at string) error {
	db.LifecycleFor(meeting).TranscriptSaved(transcript, at)
	return s.UpdateMeeting(meeting)
}

func (s *fakeStore) CompleteProcessing(meeting *db.Meeting, completion db.MeetingProcessingCompletion) error {
	db.LifecycleFor(meeting).ProcessingCompleted(completion.Title, completion.Transcript, completion.Summary, completion.ExtractionJSON, completion.At)
	return s.UpdateMeeting(meeting)
}

func (s *fakeStore) FailProcessingWithTranscript(meeting *db.Meeting, transcript, at string, failure error) error {
	db.LifecycleFor(meeting).EnhancementFailed(transcript, at, failure)
	return s.UpdateMeeting(meeting)
}

func (s *fakeStore) UpdateRecordingHeartbeat(_ string, updatedAt string) error {
	s.meeting.CaptureStatusUpdatedAt = updatedAt
	return nil
}

func (s *fakeStore) ReplaceSegments(_ string, segments []db.Segment) error {
	s.segments = append([]db.Segment(nil), segments...)
	return nil
}

func (s *fakeStore) GetMeeting(string) (*db.Meeting, error) {
	copy := *s.meeting
	return &copy, nil
}

func (s *fakeStore) GetSegments(string) ([]db.Segment, error) {
	return append([]db.Segment(nil), s.segments...), nil
}

func (s *fakeStore) ListStaleRecordingMeetings(string, int) ([]db.Meeting, error) {
	return nil, nil
}

func (s *fakeStore) ClaimStaleRecordingForProcessing(meeting *db.Meeting, _ string, endedAt string) (bool, error) {
	if err := s.MarkCaptured(meeting, endedAt); err != nil {
		return false, err
	}
	return true, nil
}

func (s *fakeStore) FailStaleRecording(meeting *db.Meeting, _ string, endedAt string, failure error) (bool, error) {
	if err := s.MarkCaptureFailed(meeting, endedAt, failure); err != nil {
		return false, err
	}
	return true, nil
}

type fakeRecorder struct {
	dir  string
	done chan error
}

func (r *fakeRecorder) Start(context.Context) error {
	artifacts := r.Artifacts()
	if err := os.WriteFile(artifacts.MicPath(), []byte(strings.Repeat("m", 45)), 0o644); err != nil {
		return err
	}
	return os.WriteFile(artifacts.SystemPath(), []byte(strings.Repeat("s", 45)), 0o644)
}

func (r *fakeRecorder) Stop() error {
	return nil
}

func (r *fakeRecorder) Done() <-chan error {
	return r.done
}

func (r *fakeRecorder) Artifacts() audioartifact.Artifacts {
	return audioartifact.New(r.dir)
}

type fakeTranscriber struct{}

func (fakeTranscriber) Transcribe(_ context.Context, audioPath string) ([]transcribe.Segment, error) {
	return []transcribe.Segment{{Start: 0, End: 1, Text: filepath.Base(audioPath) + " hello"}}, nil
}
