package recording

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/gappd-dev/gappd/internal/db"
)

func (s Service) startCaptureHeartbeat(meeting *db.Meeting) func() {
	done := make(chan struct{})
	stopped := make(chan struct{})
	go s.runCaptureHeartbeat(meeting, done, stopped)
	return func() {
		close(done)
		<-stopped
	}
}

func (s Service) runCaptureHeartbeat(meeting *db.Meeting, done <-chan struct{}, stopped chan<- struct{}) {
	defer close(stopped)
	ticker := time.NewTicker(recordingHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.saveCaptureHeartbeat(meeting)
		case <-done:
			return
		}
	}
}

func (s Service) saveCaptureHeartbeat(meeting *db.Meeting) {
	updatedAt := nowUTC()
	if err := s.meetings().UpdateRecordingHeartbeat(meeting.ID, updatedAt); err != nil && s.ErrOut != nil {
		fmt.Fprintf(s.ErrOut, "warning: update recording heartbeat: %v\n", err)
	}
	meeting.CaptureStatusUpdatedAt = updatedAt
}

func (s Service) createSessionDir(title string) (string, error) {
	dir := filepath.Join(s.BaseDir, "sessions", fmt.Sprintf("%s-%s", time.Now().Format("2006-01-02T1504"), sanitize(title)))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create session dir: %w", err)
	}
	return dir, nil
}

func (s Service) startMeeting(title, sessionDir, language string) (*db.Meeting, error) {
	now := nowUTC()
	meeting := db.NewRecordingMeeting(title, sessionDir, language, now)
	if err := s.meetings().CreateMeeting(meeting); err != nil {
		return nil, fmt.Errorf("create meeting: %w", err)
	}
	return meeting, nil
}

func (s Service) printRecorded(startedAt string) {
	started, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		fmt.Fprintf(s.ErrOut, "warning: could not parse start time: %v\n", err)
		if s.Events == nil {
			fmt.Fprintln(s.Out, "● Recorded")
		}
		return
	}
	if s.Events == nil {
		fmt.Fprintf(s.Out, "● Recorded %s\n", time.Since(started).Truncate(time.Second))
	}
}

func (s Service) emit(name EventName, meeting db.Meeting, err error) error {
	if s.Events == nil {
		return nil
	}
	return s.Events.EmitRecordingEvent(name, meeting, err)
}

func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r):
			b.WriteRune(unicode.ToLower(r))
		case r == ' ', r == '_':
			b.WriteRune('-')
		case r == '-':
			b.WriteRune(r)
		}
	}
	return b.String()
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}
