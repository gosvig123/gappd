package recording

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
)

func (w meetingRecordingWorkflow) startCaptureHeartbeat(meeting *db.Meeting) func() {
	done := make(chan struct{})
	stopped := make(chan struct{})
	go w.runCaptureHeartbeat(meeting, done, stopped)
	return func() {
		close(done)
		<-stopped
	}
}

func (w meetingRecordingWorkflow) runCaptureHeartbeat(meeting *db.Meeting, done <-chan struct{}, stopped chan<- struct{}) {
	defer close(stopped)
	ticker := time.NewTicker(recordingHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			w.saveCaptureHeartbeat(meeting)
		case <-done:
			return
		}
	}
}

func (w meetingRecordingWorkflow) saveCaptureHeartbeat(meeting *db.Meeting) {
	result, err := w.lifecycle.Heartbeat(context.Background(), meeting.ID, time.Now())
	if err != nil {
		if w.errOut != nil {
			fmt.Fprintf(w.errOut, "warning: update recording heartbeat: %v\n", err)
		}
		return
	}
	*meeting = *result.Meeting
}

func (w meetingRecordingWorkflow) createSessionDir(title string) (string, error) {
	root := filepath.Join(w.baseDir, "sessions")
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", fmt.Errorf("create sessions root: %w", err)
	}
	prefix := fmt.Sprintf("%s-%s-", time.Now().Format("2006-01-02T1504"), sanitize(title))
	dir, err := os.MkdirTemp(root, prefix)
	if err != nil {
		return "", fmt.Errorf("create session dir: %w", err)
	}
	return dir, nil
}

func (w meetingRecordingWorkflow) startMeeting(title, sessionDir, language string, speakerLabelsEnabled *bool) (*db.Meeting, error) {
	start := meetinglifecycle.RecordingStart{Title: title, SessionDir: sessionDir, Language: language,
		SpeakerLabelsEnabled: speakerLabelsEnabled, At: time.Now()}
	meeting, err := w.lifecycle.BeginRecording(context.Background(), start)
	if err != nil {
		return nil, fmt.Errorf("create meeting: %w", err)
	}
	return meeting, nil
}

func (w meetingRecordingWorkflow) printRecorded(startedAt string) {
	started, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		fmt.Fprintf(w.errOut, "warning: could not parse start time: %v\n", err)
		if w.events == nil {
			fmt.Fprintln(w.out, "● Recorded")
		}
		return
	}
	if w.events == nil {
		fmt.Fprintf(w.out, "● Recorded %s\n", time.Since(started).Truncate(time.Second))
	}
}

func (s Service) emit(name EventName, meeting db.Meeting, err error) error {
	return s.recordingWorkflow().emit(name, meeting, err)
}

func (w meetingRecordingWorkflow) emit(name EventName, meeting db.Meeting, err error) error {
	if w.events == nil {
		return nil
	}
	return w.events.EmitRecordingEvent(name, meeting, err)
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
