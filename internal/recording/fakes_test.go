package recording

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

type fakeEnhancer struct {
	summary string
	err     error
}

func (e fakeEnhancer) Run(context.Context, string, string) (*ai.Extraction, string, error) {
	return &ai.Extraction{}, e.summary, e.err
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

func (s *fakeStore) InsertSegments(segments []db.Segment) error {
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

type fakeRecorder struct {
	dir  string
	done chan error
}

func (r *fakeRecorder) Start(context.Context) error {
	if err := os.WriteFile(r.MicPath(), []byte(strings.Repeat("m", 45)), 0o644); err != nil {
		return err
	}
	return os.WriteFile(r.SystemPath(), []byte(strings.Repeat("s", 45)), 0o644)
}

func (r *fakeRecorder) Stop() error {
	return nil
}

func (r *fakeRecorder) Done() <-chan error {
	return r.done
}

func (r *fakeRecorder) MicPath() string {
	return filepath.Join(r.dir, "mic.wav")
}

func (r *fakeRecorder) SystemPath() string {
	return filepath.Join(r.dir, "system.wav")
}

type fakeTranscriber struct{}

func (fakeTranscriber) Transcribe(_ context.Context, audioPath, _ string) ([]transcribe.Segment, error) {
	return []transcribe.Segment{{Start: 0, End: 1, Text: filepath.Base(audioPath) + " hello"}}, nil
}
