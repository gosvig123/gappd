package meetinglifecycle

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestDiarizationClaimTransitionsAndRetry(t *testing.T) {
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
	if concurrent, err := store.ClaimNext(context.Background(), db.QueueStageDiarization, now, time.Minute, nil); err != nil || concurrent != nil {
		t.Fatalf("concurrent claim = %#v, %v", concurrent, err)
	}
	expired, err := store.ClaimNext(context.Background(), db.QueueStageDiarization, now.Add(2*time.Minute), time.Minute, nil)
	if err != nil || expired == nil || expired.Token == claim.Token {
		t.Fatalf("expired claim = %#v, %v", expired, err)
	}
	if stale, err := module.StartDiarization(context.Background(), meeting.ID, claim.Token); err != nil || stale.Applied {
		t.Fatalf("stale start = %#v, %v", stale, err)
	}
	claim = expired
	if result, err := module.StartDiarization(context.Background(), meeting.ID, claim.Token); err != nil || !result.Applied {
		t.Fatalf("start = %#v, %v", result, err)
	}
	if result, err := module.DegradeDiarization(context.Background(), meeting.ID, "stale", errors.New("helper failed"), now); err != nil || result.Applied {
		t.Fatalf("stale degrade = %#v, %v", result, err)
	}
	interrupted, err := module.InterruptDiarization(context.Background(), meeting.ID, claim.Token, now)
	if err != nil || !interrupted.Applied || interrupted.Meeting.DiarizationState != db.DiarizationStatePending ||
		interrupted.Meeting.ProcessingStatus != db.ProcessingStatusPending {
		t.Fatalf("interrupt = %#v, %v", interrupted, err)
	}

	claim, _ = store.ClaimNext(context.Background(), db.QueueStageDiarization, now, time.Minute, nil)
	_, _ = module.StartDiarization(context.Background(), meeting.ID, claim.Token)
	degraded, err := module.DegradeDiarization(context.Background(), meeting.ID, claim.Token, errors.New("helper failed"), now)
	if err != nil || !degraded.Applied || db.DeriveQueueStage(*degraded.Meeting) != db.QueueStageSummarization {
		t.Fatalf("degrade = %#v, %v", degraded, err)
	}
	summaryClaim, _ := store.ClaimNext(context.Background(), db.QueueStageSummarization, now, time.Minute, nil)
	if busyRetry, err := module.RetryDiarization(context.Background(), meeting.ID, now); err != nil || busyRetry.Applied {
		t.Fatalf("busy retry = %#v, %v", busyRetry, err)
	}
	if _, err := store.Conn.Exec(`UPDATE meetings SET processing_status=?,processing_claim_token=NULL,processing_claim_expires_at=NULL WHERE id=?`, db.ProcessingStatusPending, summaryClaim.Meeting.ID); err != nil {
		t.Fatal(err)
	}
	retried, err := module.RetryDiarization(context.Background(), meeting.ID, now)
	if err != nil || !retried.Applied || retried.Meeting.DiarizationState != db.DiarizationStatePending {
		t.Fatalf("retry = %#v, %v", retried, err)
	}

	claim, _ = store.ClaimNext(context.Background(), db.QueueStageDiarization, now, time.Minute, nil)
	_, _ = module.StartDiarization(context.Background(), meeting.ID, claim.Token)
	completed, err := module.CompleteDiarization(context.Background(), meeting.ID, claim.Token, `{}`, now)
	if err != nil || !completed.Applied || completed.Meeting.DiarizationState != db.DiarizationStateCompleted {
		t.Fatalf("complete = %#v, %v", completed, err)
	}
	if retried, err = module.RetryDiarization(context.Background(), meeting.ID, now); err != nil || retried.Applied {
		t.Fatalf("completed retry = %#v, %v", retried, err)
	}
}

func TestTerminalDiarizationProcessingStatusFollowsQueueFreshness(t *testing.T) {
	outcomes := []struct {
		name   string
		state  db.DiarizationState
		finish func(Module, string, string, time.Time) (Result, error)
	}{
		{name: "completed", state: db.DiarizationStateCompleted, finish: func(module Module, id, token string, at time.Time) (Result, error) {
			return module.CompleteDiarization(context.Background(), id, token, `{}`, at)
		}},
		{name: "degraded", state: db.DiarizationStateDegraded, finish: func(module Module, id, token string, at time.Time) (Result, error) {
			return module.DegradeDiarization(context.Background(), id, token, errors.New("helper failed"), at)
		}},
		{name: "not_applicable", state: db.DiarizationStateNotApplicable, finish: func(module Module, id, token string, at time.Time) (Result, error) {
			return module.MarkDiarizationNotApplicable(context.Background(), id, token, at)
		}},
	}
	artifacts := []struct {
		name            string
		summaryRevision int
		extraction      any
		wantStatus      db.ProcessingStatus
		wantStage       db.QueueStage
	}{
		{name: "current", summaryRevision: 2, extraction: `{}`, wantStatus: db.ProcessingStatusCompleted, wantStage: db.QueueStageNone},
		{name: "stale_summary", summaryRevision: 1, extraction: `{}`, wantStatus: db.ProcessingStatusPending, wantStage: db.QueueStageSummarization},
		{name: "missing_extraction", summaryRevision: 2, extraction: nil, wantStatus: db.ProcessingStatusPending, wantStage: db.QueueStageSummarization},
	}

	for _, outcome := range outcomes {
		for _, artifact := range artifacts {
			t.Run(outcome.name+"/"+artifact.name, func(t *testing.T) {
				module, store := openLifecycle(t)
				defer store.Close()
				meeting := beginRecording(t, module)
				transition(t, module, meeting.ID, Captured{At: testTime(1)})
				if _, err := store.Conn.Exec(`UPDATE meetings SET transcript='hello',transcript_revision=2,
					summary='summary',summary_transcript_revision=?,extraction_json=?,diarization_state=? WHERE id=?`,
					artifact.summaryRevision, artifact.extraction, db.DiarizationStatePending, meeting.ID); err != nil {
					t.Fatal(err)
				}
				claim, err := store.ClaimNext(context.Background(), db.QueueStageDiarization, testTime(2), time.Minute, nil)
				if err != nil || claim == nil {
					t.Fatalf("claim = %#v, %v", claim, err)
				}
				if started, err := module.StartDiarization(context.Background(), meeting.ID, claim.Token); err != nil || !started.Applied {
					t.Fatalf("start = %#v, %v", started, err)
				}
				result, err := outcome.finish(module, meeting.ID, claim.Token, testTime(3))
				if err != nil || !result.Applied {
					t.Fatalf("finish = %#v, %v", result, err)
				}
				if result.Meeting.DiarizationState != outcome.state || result.Meeting.ProcessingStatus != artifact.wantStatus {
					t.Fatalf("states = diarization %q, processing %q; want %q, %q", result.Meeting.DiarizationState,
						result.Meeting.ProcessingStatus, outcome.state, artifact.wantStatus)
				}
				if stage := db.DeriveQueueStage(*result.Meeting); stage != artifact.wantStage {
					t.Fatalf("queue stage = %q, want %q", stage, artifact.wantStage)
				}
			})
		}
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
