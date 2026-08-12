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

func TestTerminalDiarizationProcessingStatusFollowsQueueFreshness(t *testing.T) {
	outcomes := []struct {
		name   string
		state  db.DiarizationState
		finish func(Module, string, string, time.Time) (Result, error)
	}{
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
