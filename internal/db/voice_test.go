package db

import (
	"context"
	"testing"
)

func voiceVector(axis int) []float64 {
	out := make([]float64, SpeakerEmbeddingDimension)
	out[axis] = 1
	return out
}

func voiceMeeting(t *testing.T, store *DB, id string) {
	t.Helper()
	mustExec(t, store, `INSERT INTO meetings(id,title,started_at,capture_status,transcript,diarization_state)
 VALUES(?,?,'2026-01-01','captured','remote words','completed')`, id, id)
	mustExec(t, store, `INSERT INTO segments(id,meeting_id,start_sec,end_sec,text,speaker,speaker_source)
 VALUES(?,?,0,20,'words','Speaker 1','system')`, id+"-segment", id)
	addVoice(t, store, id, "Speaker 1", 0)
}

func addVoice(t *testing.T, store *DB, id, key string, axis int) {
	t.Helper()
	tx, err := store.Conn.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	e := SpeakerEmbedding{Key: key, Vector: voiceVector(axis), Model: VoiceModel, Source: "system/test", Seconds: 20, Quality: 0.95}
	if err := insertSpeakerEmbedding(tx, id, e); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func voiceCount(t *testing.T, store *DB, table string, want int) {
	t.Helper()
	var got int
	if err := store.Conn.QueryRow("SELECT count(*) FROM " + table).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s count=%d want=%d", table, got, want)
	}
}

func assignVoice(t *testing.T, store *DB, id string, person Person) {
	t.Helper()
	if err := store.AssignSpeaker(id, "Speaker 1", person); err != nil {
		t.Fatal(err)
	}
}

func recognizeVoice(t *testing.T, store *DB, id string, emails []string, calendar bool) {
	t.Helper()
	meeting, err := store.GetMeeting(id)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecognizeSpeakers(id, meeting.TranscriptRevision, emails, calendar); err != nil {
		t.Fatal(err)
	}
}

func TestVoiceEnrollmentCorrectionClearAndNoAutomaticTraining(t *testing.T) {
	store := openTestDB(t)
	voiceMeeting(t, store, "source")
	assignVoice(t, store, "source", Person{Name: "Alice", Email: "alice@example.test"})
	assignVoice(t, store, "source", Person{Name: "Alice", Email: "alice@example.test"})
	voiceCount(t, store, "voice_samples", 1)
	voiceMeeting(t, store, "target")
	recognizeVoice(t, store, "target", []string{"alice@example.test"}, true)
	segments, _ := store.GetSegments("target")
	if segments[0].Speaker != "Alice" || segments[0].IdentityOrigin != "automatic" {
		t.Fatalf("unexpected identity: %+v", segments[0])
	}
	voiceCount(t, store, "voice_samples", 1)
	assertRecognitionNoOp(t, store)
	assignVoice(t, store, "source", Person{Name: "Bob", Email: "bob@example.test"})
	recognizeVoice(t, store, "target", []string{"alice@example.test"}, true)
	segments, _ = store.GetSegments("target")
	if segments[0].PersonID != nil {
		t.Fatal("correction retained stale automatic identity")
	}
	assignVoice(t, store, "source", Person{})
	voiceCount(t, store, "voice_samples", 0)
}

func TestVoiceClearSurvivesRetryAndNeverOverridesManual(t *testing.T) {
	store := openTestDB(t)
	voiceMeeting(t, store, "source")
	voiceMeeting(t, store, "target")
	assignVoice(t, store, "source", Person{Name: "Alice", Email: "alice@example.test"})
	assignVoice(t, store, "target", Person{Name: "Bob"})
	recognizeVoice(t, store, "target", []string{"alice@example.test"}, true)
	segments, _ := store.GetSegments("target")
	if segments[0].Speaker != "Bob" {
		t.Fatal("overwrote manual identity")
	}
	assignVoice(t, store, "target", Person{})
	mustExec(t, store, `UPDATE meetings SET diarization_state='pending' WHERE id='target'`)
	voiceCount(t, store, "meeting_speaker_embeddings", 1)
	mustExec(t, store, `UPDATE meetings SET diarization_state='completed' WHERE id='target'`)
	addVoice(t, store, "target", "Speaker 1", 0)
	recognizeVoice(t, store, "target", []string{"alice@example.test"}, true)
	segments, _ = store.GetSegments("target")
	if segments[0].PersonID != nil {
		t.Fatal("restored cleared identity")
	}
}

func TestVoiceStaleProjectionRollsBackEvidenceAndIdentities(t *testing.T) {
	store, id := projectionFixture(t)
	input := projectionInput(id)
	input.Embeddings = []SpeakerEmbedding{{Key: "Speaker 1", Vector: voiceVector(0), Model: VoiceModel, Source: "test", Seconds: 20, Quality: 1}}
	input.CapturedTranscriptRevision--
	_, applied, err := store.CommitSpeakerProjection(context.Background(), input)
	if err != nil || applied {
		t.Fatalf("stale projection: %v %v", applied, err)
	}
	voiceCount(t, store, "meeting_speaker_embeddings", 0)
	input.CapturedTranscriptRevision++
	input.Assignments = append(input.Assignments, SpeakerProjectionAssignment{SegmentID: "missing", Speaker: "Speaker 2", Reason: SpeakerAssignmentReasonNoEvidence})
	before := projectionSnapshot(t, store, id)
	_, applied, err = store.CommitSpeakerProjection(context.Background(), input)
	if err != nil || applied || before != projectionSnapshot(t, store, id) {
		t.Fatal("partial projection escaped rollback")
	}
	voiceCount(t, store, "meeting_speaker_embeddings", 0)
}

func TestVoiceReplacementAndDeletionRetractEvidence(t *testing.T) {
	store := openTestDB(t)
	voiceMeeting(t, store, "source")
	assignVoice(t, store, "source", Person{Name: "Alice"})
	if err := store.ReplaceSegments("source", nil); err != nil {
		t.Fatal(err)
	}
	voiceCount(t, store, "voice_samples", 0)
	voiceCount(t, store, "meeting_speaker_embeddings", 0)
	voiceMeeting(t, store, "deleted")
	assignVoice(t, store, "deleted", Person{Name: "Bob"})
	mustExec(t, store, `DELETE FROM meetings WHERE id='deleted'`)
	voiceCount(t, store, "voice_samples", 0)
	voiceCount(t, store, "meeting_speaker_embeddings", 0)
}

func TestProjectionEmbeddingFailureIsAtomic(t *testing.T) {
	store, id := projectionFixture(t)
	input := projectionInput(id)
	e := SpeakerEmbedding{Key: "Speaker 1", Vector: voiceVector(0), Model: VoiceModel, Source: "test", Seconds: 20, Quality: 1}
	input.Embeddings = []SpeakerEmbedding{e, e}
	before := projectionSnapshot(t, store, id)
	_, applied, err := store.CommitSpeakerProjection(context.Background(), input)
	if err == nil || applied {
		t.Fatal("duplicate evidence unexpectedly committed")
	}
	if before != projectionSnapshot(t, store, id) {
		t.Fatal("failed evidence write changed projection")
	}
	voiceCount(t, store, "meeting_speaker_embeddings", 0)
}

func assertRecognitionNoOp(t *testing.T, store *DB) {
	t.Helper()
	before, _ := store.GetMeeting("target")
	recognizeVoice(t, store, "target", []string{"alice@example.test"}, true)
	after, _ := store.GetMeeting("target")
	if before.TranscriptRevision != after.TranscriptRevision {
		t.Fatal("retry invalidated summary")
	}
}

func TestExpiredSummaryClaimRecognizesBeforeRecovery(t *testing.T) {
	store := openTestDB(t)
	voiceMeeting(t, store, "source")
	voiceMeeting(t, store, "target")
	assignVoice(t, store, "source", Person{Name: "Alice", Email: "alice@example.test"})
	mustExec(t, store, `UPDATE meetings SET processing_status='processing',processing_claim_token='expired',processing_claim_expires_at='2000-01-01T00:00:00Z' WHERE id='target'`)
	targets, err := store.VoiceTargets("source")
	if err != nil || len(targets) != 1 || targets[0].ID != "target" {
		t.Fatal("expired summary omitted from voice recovery")
	}
	recognizeVoice(t, store, "target", []string{"alice@example.test"}, true)
	meeting, _ := store.GetMeeting("target")
	if meeting.ProcessingClaimToken != nil || meeting.ProcessingStatus != ProcessingStatusPending {
		t.Fatal("expired worker retained claim after identity change")
	}
	segments, _ := store.GetSegments("target")
	if segments[0].Speaker != "Alice" {
		t.Fatal("recovery omitted voice match")
	}
}
