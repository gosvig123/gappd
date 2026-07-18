package db

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestCommitSpeakerProjectionUpdatesInPlace(t *testing.T) {
	store, id := projectionFixture(t)
	before := projectionSnapshot(t, store, id)
	meeting, applied, err := store.CommitSpeakerProjection(context.Background(), projectionInput(id))
	if err != nil || !applied {
		t.Fatalf("commit = applied %v, error %v", applied, err)
	}
	after := projectionSnapshot(t, store, id)
	confidence, reason := 0.91, SpeakerAssignmentReasonThresholdAssignment
	want := append([]Segment(nil), before.segments...)
	want[1].Speaker, want[1].SpeakerConfidence, want[1].SpeakerAssignmentReason = "Speaker 1", &confidence, &reason
	if !reflect.DeepEqual(want, after.segments) {
		t.Fatal("projection changed microphone or system row shape")
	}
	if meeting.Transcript == nil || *meeting.Transcript != "[You] microphone words\n[Speaker 1] remote words\n" || meeting.TranscriptRevision != 8 {
		t.Fatal("transcript or changed revision not updated")
	}
	if meeting.Summary == nil || *meeting.Summary != "old summary" || meeting.SummaryTranscriptRevision != 7 ||
		meeting.ExtractionJSON == nil || *meeting.ExtractionJSON != `{"old":true}` || DeriveQueueStage(*meeting) != QueueStageSummarization {
		t.Fatal("summary did not remain stale")
	}
	assertProjectionCompleted(t, meeting)
}

func TestCommitSpeakerProjectionNoOpDoesNotBumpRevision(t *testing.T) {
	store, id := projectionFixture(t)
	mustExec(t, store, `UPDATE segments SET speaker='Speaker 1',speaker_confidence=.91,speaker_assignment_reason=? WHERE id='system-1'`, SpeakerAssignmentReasonThresholdAssignment)
	mustExec(t, store, `UPDATE meetings SET transcript='[You] microphone words\n[Speaker 1] remote words\n' WHERE id=?`, id)
	meeting, applied, err := store.CommitSpeakerProjection(context.Background(), projectionInput(id))
	if err != nil || !applied || meeting.TranscriptRevision != 7 || meeting.SummaryTranscriptRevision != 7 {
		t.Fatalf("no-op = applied %v, revision %d, error %v", applied, meeting.TranscriptRevision, err)
	}
	assertProjectionCompleted(t, meeting)
}

func TestCommitSpeakerProjectionRejectsStaleOrInexactInput(t *testing.T) {
	for _, name := range []string{"token", "revision", "processing state", "diarization state", "missing system row", "extra assignment", "changed source"} {
		t.Run(name, func(t *testing.T) {
			store, id := projectionFixture(t)
			input := projectionInput(id)
			switch name {
			case "token":
				input.ClaimToken = "stale"
			case "revision":
				input.CapturedTranscriptRevision--
			case "processing state":
				mustExec(t, store, `UPDATE meetings SET processing_status=? WHERE id=?`, ProcessingStatusPending, id)
			case "diarization state":
				mustExec(t, store, `UPDATE meetings SET diarization_state=? WHERE id=?`, DiarizationStatePending, id)
			case "missing system row":
				mustExec(t, store, `INSERT INTO segments (id,meeting_id,start_sec,end_sec,text,speaker,speaker_source) SELECT 'system-2',meeting_id,3,4,'more',speaker,speaker_source FROM segments WHERE id='system-1'`)
			case "extra assignment":
				input.Assignments = append(input.Assignments, SpeakerProjectionAssignment{SegmentID: "absent", Speaker: VisibleSpeakerOther, Reason: SpeakerAssignmentReasonNoEvidence})
			case "changed source":
				mustExec(t, store, `UPDATE segments SET speaker_source=? WHERE id='system-1'`, SegmentSourceMicrophone)
			}
			assertProjectionRejected(t, store, input)
		})
	}
}

func TestValidateProjectionRejectsInvalidInputBeforeTransaction(t *testing.T) {
	for _, name := range []string{"empty assignments", "null provenance", "array provenance", "oversized provenance", "unknown reason"} {
		t.Run(name, func(t *testing.T) {
			input := projectionInput("meeting-1")
			switch name {
			case "empty assignments":
				input.Assignments = nil
			case "null provenance":
				input.ProvenanceJSON = "null"
			case "array provenance":
				input.ProvenanceJSON = "[]"
			case "oversized provenance":
				input.ProvenanceJSON = `{"x":"` + strings.Repeat("x", maxProjectionProvenanceJSONBytes) + `"}`
			case "unknown reason":
				input.Assignments[0].Reason = SpeakerAssignmentReason("invented")
			}
			if _, _, err := validateProjection(input); err == nil {
				t.Fatal("validation succeeded")
			}
		})
	}
}

func TestCommitSpeakerProjectionRollsBack(t *testing.T) {
	store, id := projectionFixture(t)
	mustExec(t, store, `CREATE TRIGGER reject_projection BEFORE UPDATE ON meetings WHEN new.diarization_state='completed' BEGIN SELECT RAISE(ABORT, 'failure'); END`)
	before := projectionSnapshot(t, store, id)
	if _, applied, err := store.CommitSpeakerProjection(context.Background(), projectionInput(id)); err == nil || applied {
		t.Fatalf("failure = applied %v, error %v", applied, err)
	}
	if after := projectionSnapshot(t, store, id); !reflect.DeepEqual(before, after) {
		t.Fatal("projection was not rolled back")
	}
}

type projectionState struct {
	meeting  *Meeting
	segments []Segment
}

func projectionFixture(t *testing.T) (*DB, string) {
	t.Helper()
	store := openTestDB(t)
	t.Cleanup(func() { store.Close() })
	claim, expiry := "claim-1", "2026-04-10T13:00:00Z"
	transcript, summary, extraction := "[You] microphone words\n[Other] remote words\n", "old summary", `{"old":true}`
	diarizationError, processingError := "old diarization error", "old processing error"
	meeting := &Meeting{ID: "meeting-1", Title: "Projection", StartedAt: "2026-04-10T12:00:00Z",
		CaptureStatus: CaptureStatusCaptured, CaptureStatusUpdatedAt: "2026-04-10T12:01:00Z",
		ProcessingStatus: ProcessingStatusProcessing, ProcessingStatusUpdatedAt: "2026-04-10T12:02:00Z",
		ProcessingFailureMessage: &processingError, ProcessingClaimToken: &claim, ProcessingClaimExpiresAt: &expiry,
		Transcript: &transcript, TranscriptRevision: 7, Summary: &summary, SummaryTranscriptRevision: 7,
		ExtractionJSON: &extraction, DiarizationState: DiarizationStateProcessing, DiarizationError: &diarizationError,
		Language: "en_US", Tags: "[]", Source: "listen"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	mustExec(t, store, `INSERT INTO segments
		(id,meeting_id,start_sec,end_sec,text,speaker,speaker_source,speaker_confidence,speaker_assignment_reason,created_at)
		VALUES ('mic-1',?,.125,1.25,'microphone words',?,?,NULL,?,'2026-04-10T12:00:01.123Z'),
		('system-1',?,1.5,2.75,'remote words',?,?,NULL,?,'2026-04-10T12:00:02.456Z')`,
		meeting.ID, SpeakerYou, SegmentSourceMicrophone, SpeakerAssignmentReasonMicrophone,
		meeting.ID, SpeakerOther, SegmentSourceSystem, SpeakerAssignmentReasonPendingSystemAttribution)
	return store, meeting.ID
}

func projectionInput(id string) SpeakerProjectionCommit {
	confidence := 0.91
	return SpeakerProjectionCommit{MeetingID: id, ClaimToken: "claim-1", CapturedTranscriptRevision: 7,
		Assignments:    []SpeakerProjectionAssignment{{SegmentID: "system-1", Speaker: VisibleSpeaker("Speaker 1"), Confidence: &confidence, Reason: SpeakerAssignmentReasonThresholdAssignment}},
		ProvenanceJSON: ` { "engine": "test" } `, CompletedAt: time.Date(2026, 4, 10, 12, 3, 4, 0, time.UTC)}
}

func projectionSnapshot(t *testing.T, store *DB, id string) projectionState {
	t.Helper()
	meeting, err := store.GetMeeting(id)
	if err != nil {
		t.Fatal(err)
	}
	segments, err := store.GetSegments(id)
	if err != nil {
		t.Fatal(err)
	}
	return projectionState{meeting, segments}
}

func assertProjectionRejected(t *testing.T, store *DB, input SpeakerProjectionCommit) {
	t.Helper()
	before := projectionSnapshot(t, store, input.MeetingID)
	_, applied, err := store.CommitSpeakerProjection(context.Background(), input)
	if err != nil || applied {
		t.Fatalf("rejection = applied %v, error %v", applied, err)
	}
	if after := projectionSnapshot(t, store, input.MeetingID); !reflect.DeepEqual(before, after) {
		t.Fatal("rejected projection wrote data")
	}
}

func assertProjectionCompleted(t *testing.T, meeting *Meeting) {
	t.Helper()
	if meeting.DiarizationState != DiarizationStateCompleted || meeting.DiarizationError != nil ||
		meeting.DiarizationJSON == nil || *meeting.DiarizationJSON != `{"engine":"test"}` ||
		meeting.ProcessingStatus != ProcessingStatusPending || meeting.ProcessingStatusUpdatedAt != "2026-04-10T12:03:04.000000000Z" ||
		meeting.ProcessingFailureMessage != nil || meeting.ProcessingClaimToken != nil || meeting.ProcessingClaimExpiresAt != nil {
		t.Fatal("completion fields incorrect")
	}
}

func mustExec(t *testing.T, store *DB, query string, args ...any) {
	t.Helper()
	if _, err := store.Conn.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}
