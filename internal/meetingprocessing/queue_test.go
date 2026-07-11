package meetingprocessing

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestStageForArtifacts(t *testing.T) {
	text, summary, extraction := "transcript", "summary", "{}"
	tests := []struct {
		name    string
		meeting db.Meeting
		want    db.QueueStage
	}{
		{"empty", db.Meeting{}, db.QueueStageTranscription},
		{"transcript", db.Meeting{Transcript: &text}, db.QueueStageSummarization},
		{"complete", db.Meeting{Transcript: &text, Summary: &summary, ExtractionJSON: &extraction}, db.QueueStageNone},
		{"inconsistent", db.Meeting{Summary: &summary}, db.QueueStageRepair},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := StageFor(test.meeting); got != test.want {
				t.Fatalf("stage = %q, want %q", got, test.want)
			}
		})
	}
}

func TestTransientDrainAttemptsMeetingOnce(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	if _, err := store.Conn.Exec(`UPDATE meetings SET transcript='hello' WHERE id=?`, meeting.ID); err != nil {
		t.Fatal(err)
	}
	notes := &fakeNotes{err: errors.New("runtime unavailable")}
	service := Service{Store: store, Notes: notes}
	result, err := service.Drain(context.Background(), CapabilitySummarization)
	if err != nil {
		t.Fatal(err)
	}
	if result.Attempted != 1 || result.Requeued != 1 {
		t.Fatalf("result = %#v", result)
	}
	got := getMeeting(t, store, meeting.ID)
	if got.ProcessingStatus != db.ProcessingStatusPending {
		t.Fatalf("status = %q", got.ProcessingStatus)
	}
}

func TestCompletedAudioCleanupRetries(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	path := t.TempDir()
	if _, err := store.Conn.Exec(`UPDATE meetings SET processing_status='completed', transcript='t', summary='s', extraction_json='{}', audio_path=? WHERE id=?`, path, meeting.ID); err != nil {
		t.Fatal(err)
	}
	calls := 0
	service := Service{Store: store, Notes: &fakeNotes{}, ArtifactDeleter: func(path string) error {
		calls++
		if calls == 1 {
			return errors.New("busy")
		}
		return os.RemoveAll(path)
	}}
	first, err := service.Drain(context.Background(), CapabilitySummarization)
	if err != nil || first.CleanupFailed != 1 {
		t.Fatalf("first = %#v, %v", first, err)
	}
	if getMeeting(t, store, meeting.ID).AudioPath == nil {
		t.Fatal("failed cleanup cleared audio path")
	}
	second, err := service.Drain(context.Background(), CapabilitySummarization)
	if err != nil || second.Cleaned != 1 {
		t.Fatalf("second = %#v, %v", second, err)
	}
	if getMeeting(t, store, meeting.ID).AudioPath != nil {
		t.Fatal("successful cleanup retained audio path")
	}
}
