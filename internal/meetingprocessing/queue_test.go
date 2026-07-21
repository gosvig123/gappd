package meetingprocessing

import (
	"context"
	"errors"
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

func TestTranscriptionDrainPersistsSourceAndRevision(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := createCapturedMeeting(t, store)
	audioPath := writeUsableAudio(t)
	if _, err := store.Conn.Exec(`UPDATE meetings SET audio_path=? WHERE id=?`, audioPath, meeting.ID); err != nil {
		t.Fatal(err)
	}
	service := Service{Store: store, Transcriber: fakeTranscriber{}}
	if result, err := service.Drain(context.Background(), CapabilityTranscription); err != nil || result.Completed != 1 {
		t.Fatalf("Drain() = %#v, %v", result, err)
	}
	segments, err := store.GetSegments(meeting.ID)
	if err != nil || len(segments) != 1 || segments[0].SpeakerSource == nil ||
		*segments[0].SpeakerSource != db.SegmentSourceMicrophone || segments[0].SpeakerAssignmentReason == nil ||
		*segments[0].SpeakerAssignmentReason != db.SpeakerAssignmentReasonMicrophone {
		t.Fatalf("segments = %#v, %v", segments, err)
	}
	if got := getMeeting(t, store, meeting.ID).TranscriptRevision; got != 1 {
		t.Fatalf("transcript revision = %d, want 1", got)
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
