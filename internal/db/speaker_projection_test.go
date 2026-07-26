package db

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestCommitSpeakerProjectionUpdatesInPlace(t *testing.T) {
	store, id := projectionFixture(t)
	before, _ := store.GetSegments(id)
	meeting, applied, err := store.CommitSpeakerProjection(context.Background(), projectionInput(id))
	if err != nil || !applied {
		t.Fatalf("commit = applied %v, error %v", applied, err)
	}
	after, _ := store.GetSegments(id)
	confidence, reason := 0.91, SpeakerAssignmentReasonThresholdAssignment
	want := append([]Segment(nil), before...)
	want[1].Speaker, want[1].SpeakerConfidence, want[1].SpeakerAssignmentReason = "Speaker 1", &confidence, &reason
	if !reflect.DeepEqual(want, after) {
		t.Fatal("projection changed microphone or system row shape")
	}
	if meeting.Transcript == nil || *meeting.Transcript != "[You] microphone words\n[Speaker 1] remote words\n" || meeting.TranscriptRevision != 8 {
		t.Fatal("transcript or changed revision not updated")
	}
	if meeting.Summary == nil || *meeting.Summary != "old summary" || meeting.SummaryTranscriptRevision != 7 ||
		DeriveQueueStage(*meeting) != QueueStageSummarization {
		t.Fatal("summary did not remain stale")
	}
	if meeting.DiarizationState != DiarizationStateCompleted || meeting.DiarizationJSON == nil ||
		*meeting.DiarizationJSON != `{"engine":"test"}` || meeting.ProcessingStatus != ProcessingStatusPending || meeting.ProcessingClaimToken != nil {
		t.Fatal("completion fields incorrect")
	}
}

func TestCommitSpeakerProjectionNoOpDoesNotBumpRevision(t *testing.T) {
	store, id := projectionFixture(t)
	mustExec(t, store, `UPDATE segments SET speaker='Speaker 1',speaker_confidence=.91,speaker_assignment_reason=? WHERE id='system-1'`, SpeakerAssignmentReasonThresholdAssignment)
	mustExec(t, store, `UPDATE meetings SET transcript='[You] microphone words\n[Speaker 1] remote words\n' WHERE id=?`, id)
	meeting, applied, err := store.CommitSpeakerProjection(context.Background(), projectionInput(id))
	if err != nil || !applied || meeting.TranscriptRevision != 7 || meeting.SummaryTranscriptRevision != 7 ||
		meeting.ProcessingStatus != ProcessingStatusCompleted || DeriveQueueStage(*meeting) != QueueStageNone {
		t.Fatalf("no-op = applied %v, revision %d, status %q, stage %q, error %v", applied,
			meeting.TranscriptRevision, meeting.ProcessingStatus, DeriveQueueStage(*meeting), err)
	}
}

func TestCommitSpeakerProjectionNoOpWithStaleOrMissingArtifactsRemainsPending(t *testing.T) {
	tests := map[string]string{
		"stale summary":      `UPDATE meetings SET summary_transcript_revision=6 WHERE id=?`,
		"missing summary":    `UPDATE meetings SET summary=NULL WHERE id=?`,
		"missing extraction": `UPDATE meetings SET extraction_json=NULL WHERE id=?`,
	}
	for name, query := range tests {
		t.Run(name, func(t *testing.T) {
			store, id := projectionFixture(t)
			mustExec(t, store, `UPDATE segments SET speaker='Speaker 1',speaker_confidence=.91,speaker_assignment_reason=? WHERE id='system-1'`, SpeakerAssignmentReasonThresholdAssignment)
			mustExec(t, store, `UPDATE meetings SET transcript='[You] microphone words\n[Speaker 1] remote words\n' WHERE id=?`, id)
			mustExec(t, store, query, id)

			meeting, applied, err := store.CommitSpeakerProjection(context.Background(), projectionInput(id))
			if err != nil || !applied || meeting.TranscriptRevision != 7 ||
				meeting.ProcessingStatus != ProcessingStatusPending || DeriveQueueStage(*meeting) != QueueStageSummarization {
				t.Fatalf("no-op = applied %v, revision %d, status %q, stage %q, error %v", applied,
					meeting.TranscriptRevision, meeting.ProcessingStatus, DeriveQueueStage(*meeting), err)
			}
		})
	}
}

func TestCommitSpeakerProjectionRejectsStaleOrInexactInput(t *testing.T) {
	tests := map[string]func(*testing.T, *DB, *SpeakerProjectionCommit){
		"token":    func(_ *testing.T, _ *DB, in *SpeakerProjectionCommit) { in.ClaimToken = "stale" },
		"revision": func(_ *testing.T, _ *DB, in *SpeakerProjectionCommit) { in.CapturedTranscriptRevision-- },
		"missing system row": func(t *testing.T, s *DB, _ *SpeakerProjectionCommit) {
			mustExec(t, s, `INSERT INTO segments (id,meeting_id,start_sec,end_sec,text,speaker,speaker_source) SELECT 'system-2',meeting_id,3,4,'more',speaker,speaker_source FROM segments WHERE id='system-1'`)
		},
		"extra assignment": func(_ *testing.T, _ *DB, in *SpeakerProjectionCommit) {
			in.Assignments = append(in.Assignments, SpeakerProjectionAssignment{SegmentID: "absent", Speaker: VisibleSpeakerOther, Reason: SpeakerAssignmentReasonNoEvidence})
		},
		"oversized provenance": func(_ *testing.T, _ *DB, in *SpeakerProjectionCommit) {
			in.ProvenanceJSON = `{"x":"` + strings.Repeat("x", maxProjectionProvenanceJSONBytes) + `"}`
		},
	}
	for name, mutate := range tests {
		store, id := projectionFixture(t)
		input := projectionInput(id)
		mutate(t, store, &input)
		before := projectionSnapshot(t, store, id)
		_, applied, err := store.CommitSpeakerProjection(context.Background(), input)
		if applied || before != projectionSnapshot(t, store, id) || (err != nil) != (name == "oversized provenance") {
			t.Fatalf("%s rejection = applied %v, error %v", name, applied, err)
		}
	}
}

func TestCommitSpeakerProjectionRollsBack(t *testing.T) {
	store, id := projectionFixture(t)
	mustExec(t, store, `CREATE TRIGGER reject_projection BEFORE UPDATE ON meetings WHEN new.diarization_state='completed' BEGIN SELECT RAISE(ABORT, 'failure'); END`)
	before := projectionSnapshot(t, store, id)
	if _, applied, err := store.CommitSpeakerProjection(context.Background(), projectionInput(id)); err == nil || applied {
		t.Fatalf("failure = applied %v, error %v", applied, err)
	}
	if after := projectionSnapshot(t, store, id); before != after {
		t.Fatal("projection was not rolled back")
	}
}

func projectionFixture(t *testing.T) (*DB, string) {
	t.Helper()
	store := openTestDB(t)
	t.Cleanup(func() { store.Close() })
	id := "meeting-1"
	mustExec(t, store, `INSERT INTO meetings
		(id,title,started_at,capture_status,processing_status,processing_status_updated_at,processing_claim_token,
		transcript,transcript_revision,summary,summary_transcript_revision,extraction_json,diarization_state)
		VALUES (?,'Projection','2026-04-10T12:00:00Z',?,?,'2026-04-10T12:02:00Z','claim-1',?,7,
		'old summary',7,'{"old":true}',?)`, id, CaptureStatusCaptured, ProcessingStatusProcessing,
		"[You] microphone words\n[Other] remote words\n", DiarizationStateProcessing)
	mustExec(t, store, `INSERT INTO segments
		(id,meeting_id,start_sec,end_sec,text,speaker,speaker_source,speaker_assignment_reason) VALUES
		('mic-1',?,.125,1.25,'microphone words',?,?,?),
		('system-1',?,1.5,2.75,'remote words',?,?,?)`,
		id, SpeakerYou, SegmentSourceMicrophone, SpeakerAssignmentReasonMicrophone,
		id, SpeakerOther, SegmentSourceSystem, SpeakerAssignmentReasonPendingSystemAttribution)
	return store, id
}

func projectionInput(id string) SpeakerProjectionCommit {
	confidence := 0.91
	return SpeakerProjectionCommit{MeetingID: id, ClaimToken: "claim-1", CapturedTranscriptRevision: 7,
		Assignments:    []SpeakerProjectionAssignment{{SegmentID: "system-1", Speaker: VisibleSpeaker("Speaker 1"), Confidence: &confidence, Reason: SpeakerAssignmentReasonThresholdAssignment}},
		ProvenanceJSON: ` { "engine": "test" } `, CompletedAt: time.Date(2026, 4, 10, 12, 3, 4, 0, time.UTC)}
}

func projectionSnapshot(t *testing.T, store *DB, id string) string {
	t.Helper()
	meeting, _ := store.GetMeeting(id)
	segments, _ := store.GetSegments(id)
	data, _ := json.Marshal(struct {
		Meeting  *Meeting
		Segments []Segment
	}{meeting, segments})
	return string(data)
}

func mustExec(t *testing.T, store *DB, query string, args ...any) {
	t.Helper()
	if _, err := store.Conn.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}
