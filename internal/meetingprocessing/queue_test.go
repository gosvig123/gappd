package meetingprocessing

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/diarize"
)

func TestDeriveQueueStageArtifacts(t *testing.T) {
	text, summary, extraction := "transcript", "summary", "{}"
	tests := []struct {
		name    string
		meeting db.Meeting
		want    db.QueueStage
	}{
		{"empty before diarization", db.Meeting{DiarizationState: db.DiarizationStatePending}, db.QueueStageTranscription},
		{"legacy bypass", db.Meeting{Transcript: &text, DiarizationState: db.DiarizationStateNotRequested}, db.QueueStageSummarization},
		{"pending diarization", db.Meeting{Transcript: &text, DiarizationState: db.DiarizationStatePending}, db.QueueStageDiarization},
		{"completed", db.Meeting{Transcript: &text, Summary: &summary, ExtractionJSON: &extraction, DiarizationState: db.DiarizationStateCompleted}, db.QueueStageNone},
		{"degraded unblocks summary", db.Meeting{Transcript: &text, DiarizationState: db.DiarizationStateDegraded}, db.QueueStageSummarization},
		{"inconsistent", db.Meeting{Summary: &summary}, db.QueueStageRepair},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := db.DeriveQueueStage(test.meeting); got != test.want {
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
	if result, err := (Service{Store: store, Transcriber: fakeTranscriber{}}).Drain(context.Background(), CapabilityTranscription); err != nil || result.Completed != 1 {
		t.Fatalf("Drain() = %#v, %v", result, err)
	}
	segments, err := store.GetSegments(meeting.ID)
	if err != nil || len(segments) != 1 || segments[0].Speaker != db.SpeakerYou || segments[0].SpeakerSource == nil ||
		*segments[0].SpeakerSource != db.SegmentSourceMicrophone || segments[0].SpeakerAssignmentReason == nil ||
		*segments[0].SpeakerAssignmentReason != db.SpeakerAssignmentReasonMicrophone ||
		getMeeting(t, store, meeting.ID).TranscriptRevision != 1 {
		t.Fatalf("segments = %#v, %v", segments, err)
	}
}

func TestDiarizationDrainOutcomes(t *testing.T) {
	for _, mode := range []string{"success", "cancel", "failure"} {
		t.Run(mode, func(t *testing.T) {
			store := openTestDB(t)
			defer store.Close()
			meeting := createCapturedMeeting(t, store)
			if _, err := store.Conn.Exec(`UPDATE meetings SET audio_path=?,transcript='hello',diarization_state=? WHERE id=?`, t.TempDir(), db.DiarizationStatePending, meeting.ID); err != nil {
				t.Fatal(err)
			}
			mic, system := db.SegmentSourceMicrophone, db.SegmentSourceSystem
			_ = store.InsertSegment(&db.Segment{ID: "mic", MeetingID: meeting.ID, Start: 0, End: .5, Text: "mine", Speaker: "You", SpeakerSource: &mic})
			_ = store.InsertSegment(&db.Segment{ID: "system-1", MeetingID: meeting.ID, Start: 0, End: 1, Text: "one", Speaker: "Other", SpeakerSource: &system})
			_ = store.InsertSegment(&db.Segment{ID: "system-2", MeetingID: meeting.ID, Start: 2, End: 3, Text: "two", Speaker: "Other", SpeakerSource: &system})
			windows := []diarize.WindowReport{{DurationSeconds: 3, Clusters: []diarize.LocalCluster{{ID: "a", Centroid: []float64{1}}}, Spans: []diarize.LocalSpan{{ClusterID: "a", StartSeconds: 0, EndSeconds: 1, Quality: 1, Identity: 1}}}}
			runErr := map[string]error{"cancel": context.Canceled, "failure": errors.New("/private/helper: raw stderr")}[mode]
			runner := func(context.Context, string) ([]diarize.WindowReport, error) { return windows, runErr }
			result, err := (Service{Store: store, RunDiarization: runner}).Drain(context.Background(), CapabilityDiarization)
			if err != nil {
				t.Fatal(err)
			}
			got := getMeeting(t, store, meeting.ID)
			segments, _ := store.GetSegments(meeting.ID)
			valid := false
			switch mode {
			case "success":
				valid = result.Completed == 1 && segments[1].Speaker == "Speaker 1" && segments[2].Speaker == "Other" && got.DiarizationJSON != nil && strings.Contains(*got.DiarizationJSON, `"engine":"`+diarize.Engine+`"`) && strings.Contains(*got.DiarizationJSON, `"engineRevision":"`+diarize.EngineRevision+`"`) && strings.Contains(*got.DiarizationJSON, `"semantics":"`+diarize.ProjectionSemantics+`"`) && strings.Contains(*got.DiarizationJSON, `"speakerCount":2`) && strings.Contains(*got.DiarizationJSON, `"coverage":`)
			case "cancel":
				valid = result.Requeued == 1 && got.DiarizationState == db.DiarizationStatePending
			case "failure":
				valid = result.Failed == 1 && got.DiarizationState == db.DiarizationStateDegraded && got.DiarizationError != nil && *got.DiarizationError == "Speaker labeling failed"
			}
			if !valid {
				t.Fatalf("%s: result=%#v meeting=%#v segments=%#v", mode, result, got, segments)
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
