package db

import (
	"context"
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
	if got.Transcript == nil || *got.Transcript != "hello" || got.ProcessingStatus != ProcessingStatusPending {
		t.Fatalf("meeting = %#v", got)
	}
}

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
