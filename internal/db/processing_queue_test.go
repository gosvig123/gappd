package db

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestClaimExclusiveExpiryAndStaleToken(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	meeting := queueMeeting(t, store, "oldest", "2026-01-01T00:00:00Z")
	now := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	first, err := store.ClaimNext(context.Background(), QueueStageTranscription, now, time.Minute, nil)
	if err != nil || first == nil {
		t.Fatalf("first claim = %#v, %v", first, err)
	}
	second, err := store.ClaimNext(context.Background(), QueueStageTranscription, now, time.Minute, nil)
	if err != nil || second != nil {
		t.Fatalf("concurrent claim = %#v, %v", second, err)
	}
	if ok, err := store.RenewClaim(context.Background(), meeting.ID, "stale", now, time.Minute); err != nil || ok {
		t.Fatalf("stale renewal = %v, %v", ok, err)
	}
	if ok, err := store.RenewClaim(context.Background(), meeting.ID, first.Token, now.Add(30*time.Second), time.Minute); err != nil || !ok {
		t.Fatalf("renewal = %v, %v", ok, err)
	}
	expired, err := store.ClaimNext(context.Background(), QueueStageTranscription, now.Add(2*time.Minute), time.Minute, nil)
	if err != nil || expired == nil || expired.Token == first.Token {
		t.Fatalf("expired claim = %#v, %v", expired, err)
	}
	first.Meeting.ProcessingStatus = ProcessingStatusPending
	first.Meeting.ProcessingStatusUpdatedAt = stamp(now)
	ok, err := store.CommitClaim(context.Background(), &first.Meeting, first.Token)
	if err != nil || ok {
		t.Fatalf("stale release = %v, %v", ok, err)
	}
	expired.Meeting.ProcessingStatus = ProcessingStatusPending
	expired.Meeting.ProcessingStatusUpdatedAt = stamp(now)
	ok, err = store.CommitClaim(context.Background(), &expired.Meeting, expired.Token)
	if err != nil || !ok {
		t.Fatalf("current release = %v, %v", ok, err)
	}
}

func TestClaimQueuesStaleSummaryWithoutClearingIt(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	meeting := queueMeeting(t, store, "stale-summary", "2026-01-01T00:00:00Z")
	_, _ = store.Conn.Exec(`UPDATE meetings SET transcript='new',transcript_revision=2,summary='visible',
		summary_transcript_revision=1,extraction_json='{}',diarization_state=? WHERE id=?`, DiarizationStateCompleted, meeting.ID)
	claim, err := store.ClaimNext(context.Background(), QueueStageSummarization, time.Now(), time.Minute, nil)
	if err != nil || claim == nil || claim.Meeting.Summary == nil || *claim.Meeting.Summary != "visible" {
		t.Fatalf("stale summary claim = %#v, %v", claim, err)
	}
}

func TestPendingStagesReturnsOnlyRunnableWork(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	queueMeeting(t, store, "transcription", "2026-01-01T00:00:00Z")
	diarization := queueMeeting(t, store, "diarization", "2026-01-02T00:00:00Z")
	summary := queueMeeting(t, store, "summary", "2026-01-03T00:00:00Z")
	_, _ = store.Conn.Exec(`UPDATE meetings SET transcript='ready',diarization_state=? WHERE id=?`, DiarizationStatePending, diarization.ID)
	_, _ = store.Conn.Exec(`UPDATE meetings SET transcript='ready',diarization_state=? WHERE id=?`, DiarizationStateCompleted, summary.ID)
	stages, err := store.PendingStages(context.Background(), time.Now(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	want := []QueueStage{QueueStageTranscription, QueueStageDiarization, QueueStageSummarization}
	if !reflect.DeepEqual(stages, want) {
		t.Fatalf("stages = %v, want %v", stages, want)
	}
}

func TestPendingStagesHonorsClaimExpiry(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	now := time.Now()
	queueMeeting(t, store, "claimed", "2026-01-01T00:00:00Z")
	if _, err := store.ClaimNext(context.Background(), QueueStageTranscription, now, time.Minute, nil); err != nil {
		t.Fatal(err)
	}
	active, _ := store.PendingStages(context.Background(), now, time.Minute)
	expired, _ := store.PendingStages(context.Background(), now.Add(2*time.Minute), time.Minute)
	if len(active) != 0 || !reflect.DeepEqual(expired, []QueueStage{QueueStageTranscription}) {
		t.Fatalf("active = %v, expired = %v", active, expired)
	}
}

func TestClaimRecoversStaleUnclaimedProcessing(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	meeting := queueMeeting(t, store, "abandoned", "2026-01-01T00:00:00Z")
	_, err := store.Conn.Exec(`UPDATE meetings SET processing_status=?, processing_status_updated_at=? WHERE id=?`,
		ProcessingStatusProcessing, "2026-01-01T00:00:00Z", meeting.ID)
	if err != nil {
		t.Fatal(err)
	}
	claim, err := store.ClaimNext(context.Background(), QueueStageTranscription, time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), time.Minute, nil)
	if err != nil || claim == nil || claim.Meeting.ID != meeting.ID {
		t.Fatalf("recovered claim = %#v, %v", claim, err)
	}
}

func TestClaimUsesOldestEligibleMeeting(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	queueMeeting(t, store, "new", "2026-01-02T00:00:00Z")
	queueMeeting(t, store, "old", "2026-01-01T00:00:00Z")
	claim, err := store.ClaimNext(context.Background(), QueueStageTranscription, time.Now(), time.Minute, nil)
	if err != nil || claim.Meeting.ID != "old" {
		t.Fatalf("claim = %#v, %v", claim, err)
	}
}

func TestCommitClaimTranscriptIsAtomicAndTokenChecked(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	meeting := queueMeeting(t, store, "atomic", "2026-01-01T00:00:00Z")
	claim, _ := store.ClaimNext(context.Background(), QueueStageTranscription, time.Now(), time.Minute, nil)
	segments := []Segment{{ID: "segment", MeetingID: meeting.ID, Text: "hello", End: 1}}
	transcript := "hello"
	claim.Meeting.Transcript = &transcript
	claim.Meeting.ProcessingStatus = ProcessingStatusPending
	claim.Meeting.ProcessingStatusUpdatedAt = stamp(time.Now())
	ok, err := store.CommitClaimTranscript(context.Background(), &claim.Meeting, "stale", segments)
	if err != nil || ok {
		t.Fatalf("stale commit = %v, %v", ok, err)
	}
	if got, _ := store.GetSegments(meeting.ID); len(got) != 0 {
		t.Fatal("stale commit changed segments")
	}
	ok, err = store.CommitClaimTranscript(context.Background(), &claim.Meeting, claim.Token, segments)
	if err != nil || !ok {
		t.Fatalf("commit = %v, %v", ok, err)
	}
	got, _ := store.GetMeeting(meeting.ID)
	if got.Transcript == nil || *got.Transcript != "hello" || got.ProcessingStatus != ProcessingStatusPending || got.TranscriptRevision != 1 {
		t.Fatalf("meeting = %#v", got)
	}
}

func TestProcessingArtifactsCurrentSQLMatchesModel(t *testing.T) {
	store := openQueueDB(t)
	defer store.Close()
	cases := map[string]Meeting{
		"current":            artifactMeeting(artifact("transcript"), artifact("summary"), artifact(`{}`), 2, 2),
		"missing transcript": artifactMeeting(nil, artifact("summary"), artifact(`{}`), 2, 2),
		"blank transcript":   artifactMeeting(artifact(" "), artifact("summary"), artifact(`{}`), 2, 2),
		"missing summary":    artifactMeeting(artifact("transcript"), nil, artifact(`{}`), 2, 2),
		"blank summary":      artifactMeeting(artifact("transcript"), artifact(" "), artifact(`{}`), 2, 2),
		"missing extraction": artifactMeeting(artifact("transcript"), artifact("summary"), nil, 2, 2),
		"blank extraction":   artifactMeeting(artifact("transcript"), artifact("summary"), artifact(" "), 2, 2),
		"stale summary":      artifactMeeting(artifact("transcript"), artifact("summary"), artifact(`{}`), 2, 1),
	}
	query := `SELECT ` + ProcessingArtifactsCurrentSQL("transcript", "transcript_revision") + ` FROM (SELECT ? AS transcript,? AS transcript_revision,? AS summary,? AS summary_transcript_revision,? AS extraction_json)`
	for name, meeting := range cases {
		t.Run(name, func(t *testing.T) {
			var got bool
			err := store.Conn.QueryRow(query, meeting.Transcript, meeting.TranscriptRevision, meeting.Summary,
				meeting.SummaryTranscriptRevision, meeting.ExtractionJSON).Scan(&got)
			if err != nil || got != processingArtifactsCurrent(meeting) {
				t.Fatalf("SQL current = %v, model current = %v, error = %v", got, processingArtifactsCurrent(meeting), err)
			}
		})
	}
}

func artifactMeeting(transcript, summary, extraction *string, revision, summaryRevision int) Meeting {
	return Meeting{Transcript: transcript, Summary: summary, ExtractionJSON: extraction,
		TranscriptRevision: revision, SummaryTranscriptRevision: summaryRevision}
}

func artifact(value string) *string { return &value }

func openQueueDB(t *testing.T) *DB {
	t.Helper()
	store, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	return store
}

func queueMeeting(t *testing.T, store *DB, id, started string) *Meeting {
	t.Helper()
	meeting := &Meeting{ID: id, Title: id, StartedAt: started, EndedAt: &started, CaptureStatus: CaptureStatusCaptured,
		CaptureStatusUpdatedAt: started, ProcessingStatus: ProcessingStatusPending, ProcessingStatusUpdatedAt: started,
		Language: "en_US", Tags: "[]", Source: "test"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatal(err)
	}
	return meeting
}
