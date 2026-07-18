package meetinglifecycle

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestDiarizationClaimRecoveryAndRetry(t *testing.T) {
	module, store := openLifecycle(t)
	defer store.Close()
	meeting := beginRecording(t, module)
	transition(t, module, meeting.ID, Captured{At: testTime(1)})
	if _, err := store.Conn.Exec(`UPDATE meetings SET transcript='hello',transcript_revision=1,diarization_state=? WHERE id=?`, db.DiarizationStatePending, meeting.ID); err != nil {
		t.Fatal(err)
	}
	now := testTime(2)
	claim, err := store.ClaimNext(context.Background(), db.QueueStageDiarization, now, time.Minute, nil)
	if err != nil || claim == nil {
		t.Fatalf("claim = %#v, %v", claim, err)
	}
	if result, err := module.StartDiarization(context.Background(), meeting.ID, claim.Token); err != nil || !result.Applied {
		t.Fatalf("start = %#v, %v", result, err)
	}
	recovered, err := store.ClaimNext(context.Background(), db.QueueStageDiarization, now.Add(2*time.Minute), time.Minute, nil)
	if err != nil || recovered == nil || recovered.Token == claim.Token {
		t.Fatalf("recovered claim = %#v, %v", recovered, err)
	}
	if result, err := module.StartDiarization(context.Background(), meeting.ID, recovered.Token); err != nil || !result.Applied {
		t.Fatalf("restart = %#v, %v", result, err)
	}
	degraded, err := module.DegradeDiarization(context.Background(), meeting.ID, recovered.Token, errors.New("helper failed"), now)
	if err != nil || !degraded.Applied || db.DeriveQueueStage(*degraded.Meeting) != db.QueueStageSummarization {
		t.Fatalf("degrade = %#v, %v", degraded, err)
	}
	summaryClaim, _ := store.ClaimNext(context.Background(), db.QueueStageSummarization, now, time.Minute, nil)
	if busy, err := module.RetryDiarization(context.Background(), meeting.ID, now); err != nil || busy.Applied {
		t.Fatalf("busy retry = %#v, %v", busy, err)
	}
	if _, err := store.Conn.Exec(`UPDATE meetings SET processing_status=?,processing_claim_token=NULL,processing_claim_expires_at=NULL WHERE id=?`, db.ProcessingStatusPending, summaryClaim.Meeting.ID); err != nil {
		t.Fatal(err)
	}
	retried, err := module.RetryDiarization(context.Background(), meeting.ID, now)
	if err != nil || !retried.Applied || retried.Meeting.DiarizationState != db.DiarizationStatePending {
		t.Fatalf("retry = %#v, %v", retried, err)
	}
	if retried, err = module.RetryDiarization(context.Background(), meeting.ID, now); err != nil || retried.Applied {
		t.Fatalf("non-degraded retry = %#v, %v", retried, err)
	}
}

func TestDiarizationNotApplicableSeam(t *testing.T) {
	module, store := openLifecycle(t)
	defer store.Close()
	meeting := beginRecording(t, module)
	transition(t, module, meeting.ID, Captured{At: testTime(1)})
	_, _ = store.Conn.Exec(`UPDATE meetings SET transcript='hello',diarization_state=? WHERE id=?`, db.DiarizationStatePending, meeting.ID)
	claim, _ := store.ClaimNext(context.Background(), db.QueueStageDiarization, testTime(2), time.Minute, nil)
	_, _ = module.StartDiarization(context.Background(), meeting.ID, claim.Token)
	result, err := module.MarkDiarizationNotApplicable(context.Background(), meeting.ID, claim.Token, testTime(2))
	if err != nil || !result.Applied || result.Meeting.DiarizationState != db.DiarizationStateNotApplicable || db.DeriveQueueStage(*result.Meeting) != db.QueueStageSummarization {
		t.Fatalf("not applicable = %#v, %v", result, err)
	}
}
