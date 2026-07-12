package meetinglifecycle

import (
	"context"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func (w Module) TransitionClaim(ctx context.Context, id, token string, transition Transition) (Result, error) {
	meeting, owned, err := w.loadClaim(id, token)
	if err != nil || !owned {
		return Result{Meeting: meeting}, err
	}
	changed, err := transition.apply(meeting)
	if err != nil || !changed {
		return Result{Meeting: meeting}, err
	}
	applied, err := w.store.CommitClaim(ctx, meeting, token)
	return Result{Meeting: meeting, Applied: applied}, err
}

func (w Module) SaveClaimTranscript(ctx context.Context, id, token, transcript string, segments []db.Segment, at time.Time) (Result, error) {
	meeting, owned, err := w.loadClaim(id, token)
	if err != nil || !owned {
		return Result{Meeting: meeting}, err
	}
	if _, err := (TranscriptSaved{At: at, Transcript: transcript}).apply(meeting); err != nil {
		return Result{Meeting: meeting}, err
	}
	if _, err := (ProcessingRequeued{At: at}).apply(meeting); err != nil {
		return Result{Meeting: meeting}, err
	}
	applied, err := w.store.CommitClaimTranscript(ctx, meeting, token, segments)
	return Result{Meeting: meeting, Applied: applied}, err
}

func (w Module) loadClaim(id, token string) (*db.Meeting, bool, error) {
	meeting, err := w.store.GetMeeting(id)
	if err != nil {
		return nil, false, err
	}
	owned := meeting.ProcessingStatus == db.ProcessingStatusProcessing &&
		meeting.ProcessingClaimToken != nil && *meeting.ProcessingClaimToken == token
	return meeting, owned, nil
}
