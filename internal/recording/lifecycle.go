package recording

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/gappd-dev/gappd/internal/db"
)

func (s Service) FailCapture(meeting *db.Meeting, captureErr error) error {
	now := nowUTC()
	meeting.EndedAt = &now
	setCaptureStatus(meeting, db.CaptureStatusFailed, now, captureErr)
	if err := s.meetings().UpdateMeeting(meeting); err != nil {
		return fmt.Errorf("mark meeting capture failed: %w", err)
	}
	return s.emit(EventFailed, *meeting, captureErr)
}

func (s Service) saveProcessingFailure(meeting *db.Meeting, origErr error) error {
	now := nowUTC()
	if meeting.EndedAt == nil {
		meeting.EndedAt = &now
	}
	setProcessingStatus(meeting, db.ProcessingStatusFailed, now, origErr)
	updateErr := s.meetings().UpdateMeeting(meeting)
	if updateErr == nil && meeting.AudioPath != nil && s.Events == nil {
		fmt.Fprintf(s.Out, "  session saved (audio may be incomplete — check %s)\n", *meeting.AudioPath)
	}
	if updateErr != nil {
		return errors.Join(fmt.Errorf("transcription failed: %w", origErr), fmt.Errorf("save partial meeting: %w", updateErr))
	}
	if err := s.emit(EventFailed, *meeting, origErr); err != nil {
		return err
	}
	return fmt.Errorf("transcription failed: %w", origErr)
}

func (s Service) createSessionDir(title string) (string, error) {
	dir := filepath.Join(s.BaseDir, "sessions", fmt.Sprintf("%s-%s", time.Now().Format("2006-01-02T1504"), sanitize(title)))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create session dir: %w", err)
	}
	return dir, nil
}

func (s Service) startMeeting(title, sessionDir string) (*db.Meeting, error) {
	now := nowUTC()
	meeting := &db.Meeting{Title: title, StartedAt: now, CaptureStatus: db.CaptureStatusRecording, CaptureStatusUpdatedAt: now, ProcessingStatus: db.ProcessingStatusNotStarted, ProcessingStatusUpdatedAt: now, AudioPath: &sessionDir, Source: "listen"}
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

func setCaptureStatus(meeting *db.Meeting, status db.CaptureStatus, updatedAt string, err error) {
	meeting.CaptureStatus = status
	meeting.CaptureStatusUpdatedAt = updatedAt
	meeting.CaptureFailureMessage = failureMessage(err)
}

func setProcessingStatus(meeting *db.Meeting, status db.ProcessingStatus, updatedAt string, err error) {
	meeting.ProcessingStatus = status
	meeting.ProcessingStatusUpdatedAt = updatedAt
	meeting.ProcessingFailureMessage = failureMessage(err)
}

func failureMessage(err error) *string {
	if err == nil {
		return nil
	}
	message := err.Error()
	return &message
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}
