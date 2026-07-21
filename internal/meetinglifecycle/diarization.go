package meetinglifecycle

import (
	"context"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

func (w Module) StartDiarization(ctx context.Context, id, token string) (Result, error) {
	return w.updateDiarization(ctx, id, `UPDATE meetings SET diarization_state=?,diarization_error=NULL,diarization_json=NULL
		WHERE id=? AND diarization_state IN (?,?) AND processing_status=? AND processing_claim_token=?`,
		db.DiarizationStateProcessing, id, db.DiarizationStatePending, db.DiarizationStateProcessing, db.ProcessingStatusProcessing, token)
}

func (w Module) CompleteDiarization(ctx context.Context, id, token, resultJSON string, at time.Time) (Result, error) {
	return w.finishDiarization(ctx, id, token, db.DiarizationStateCompleted, nil, &resultJSON, at)
}

func (w Module) DegradeDiarization(ctx context.Context, id, token string, cause error, at time.Time) (Result, error) {
	if cause == nil {
		return Result{}, fmt.Errorf("degrade diarization requires cause")
	}
	message := cause.Error()
	return w.finishDiarization(ctx, id, token, db.DiarizationStateDegraded, &message, nil, at)
}

func (w Module) InterruptDiarization(ctx context.Context, id, token string, at time.Time) (Result, error) {
	return w.finishDiarization(ctx, id, token, db.DiarizationStatePending, nil, nil, at)
}

func (w Module) MarkDiarizationNotApplicable(ctx context.Context, id, token string, at time.Time) (Result, error) {
	return w.finishDiarization(ctx, id, token, db.DiarizationStateNotApplicable, nil, nil, at)
}

func (w Module) finishDiarization(ctx context.Context, id, token string, state db.DiarizationState, diarizationError, resultJSON *string, at time.Time) (Result, error) {
	processingStatus := `?`
	processingArgs := []any{db.ProcessingStatusPending}
	switch state {
	case db.DiarizationStateCompleted, db.DiarizationStateDegraded, db.DiarizationStateNotApplicable:
		processingStatus = `CASE WHEN transcript IS NOT NULL AND trim(transcript)<>''
			AND summary IS NOT NULL AND trim(summary)<>''
			AND extraction_json IS NOT NULL AND trim(extraction_json)<>''
			AND summary_transcript_revision=transcript_revision THEN ? ELSE ? END`
		processingArgs = []any{db.ProcessingStatusCompleted, db.ProcessingStatusPending}
	}
	args := []any{state, diarizationError, resultJSON}
	args = append(args, processingArgs...)
	args = append(args, timestamp(at), id, db.DiarizationStateProcessing, db.ProcessingStatusProcessing, token)
	return w.updateDiarization(ctx, id, `UPDATE meetings SET diarization_state=?,diarization_error=?,diarization_json=?,
		processing_status=`+processingStatus+`,processing_status_updated_at=?,processing_failure_message=NULL,
		processing_claim_token=NULL,processing_claim_expires_at=NULL
		WHERE id=? AND diarization_state=? AND processing_status=? AND processing_claim_token=?`, args...)
}

func (w Module) RetryDiarization(ctx context.Context, id string, at time.Time) (Result, error) {
	return w.updateDiarization(ctx, id, `UPDATE meetings SET diarization_state=?,diarization_error=NULL,diarization_json=NULL,
		processing_status=?,processing_status_updated_at=?,processing_failure_message=NULL,
		processing_claim_token=NULL,processing_claim_expires_at=NULL
		WHERE id=? AND capture_status=? AND diarization_state=? AND processing_status<>?`,
		db.DiarizationStatePending, db.ProcessingStatusPending, timestamp(at), id, db.CaptureStatusCaptured,
		db.DiarizationStateDegraded, db.ProcessingStatusProcessing)
}

func (w Module) updateDiarization(ctx context.Context, id, query string, args ...any) (Result, error) {
	result, err := w.store.Conn.ExecContext(ctx, query, args...)
	if err != nil {
		return Result{}, fmt.Errorf("transition meeting %s diarization: %w", id, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return Result{}, err
	}
	meeting, loadErr := w.store.GetMeeting(id)
	return Result{Meeting: meeting, Applied: rows > 0}, loadErr
}
