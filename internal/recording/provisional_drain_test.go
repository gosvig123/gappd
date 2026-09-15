package recording

import (
	"context"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/livetranscript"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func TestRunDrainsProvisionalWritesBeforeCaptured(t *testing.T) {
	setRecordingCaptureHelper(t, "complete-stream")
	store := openTestDB(t)
	defer store.Close()
	requireProvisionalWritesBeforeCaptured(t, store)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	lifecycle := meetinglifecycle.New(store)
	live := livetranscript.New(store, lifecycle, livetranscript.TranscriberFunc(delayedProvisionalChunk))
	service := New(lifecycle, live)
	service.BaseDir, service.Events = t.TempDir(), &recordingEvents{onEvent: cancelOnStarted(cancel)}
	if err := service.run(ctx, Request{Title: "Drain ordering"}); err != nil {
		t.Fatal(err)
	}
	assertCapturedMeetingWithLiveTranscript(t, latestMeeting(t, store))
}

func requireProvisionalWritesBeforeCaptured(t *testing.T, store *db.DB) {
	t.Helper()
	// Enforce the ordering at the actual SQL update, not the later recording.captured event.
	_, err := store.Conn.Exec(`CREATE TRIGGER require_drained_capture BEFORE UPDATE OF capture_status ON meetings
 WHEN NEW.capture_status='captured' AND (SELECT COUNT(*) FROM segments WHERE meeting_id=NEW.id)<>2
 BEGIN SELECT RAISE(ABORT, 'Captured before provisional writes drained'); END`)
	if err != nil {
		t.Fatal(err)
	}
}

func delayedProvisionalChunk(ctx context.Context, path, language string) ([]transcribe.Segment, error) {
	// Keep work active past the fake helper's one-second stop delay.
	timer := time.NewTimer(1100 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return (fakeTranscriber{}).Transcribe(ctx, path, language)
	}
}
