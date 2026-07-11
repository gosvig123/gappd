package db

import (
	"context"
	"fmt"
	"time"
)

func (d *DB) RenewClaim(ctx context.Context, id, token string, now time.Time, ttl time.Duration) (bool, error) {
	result, err := d.Conn.ExecContext(ctx, `UPDATE meetings SET processing_claim_expires_at=?, processing_status_updated_at=?
		WHERE id=? AND processing_status=? AND processing_claim_token=?`, stamp(now.Add(ttl)), stamp(now), id, ProcessingStatusProcessing, token)
	return rowsChanged(result, err, "renew processing claim")
}

func (d *DB) ReleaseClaim(ctx context.Context, id, token string, at time.Time) (bool, error) {
	return d.setClaimStatus(ctx, id, token, ProcessingStatusPending, at, nil)
}

func (d *DB) FailClaim(ctx context.Context, id, token string, at time.Time, cause error) (bool, error) {
	if cause == nil {
		return false, fmt.Errorf("fail processing claim: cause is required")
	}
	message := cause.Error()
	return d.setClaimStatus(ctx, id, token, ProcessingStatusFailed, at, &message)
}

func (d *DB) setClaimStatus(ctx context.Context, id, token string, status ProcessingStatus, at time.Time, message *string) (bool, error) {
	result, err := d.Conn.ExecContext(ctx, `UPDATE meetings SET processing_status=?, processing_status_updated_at=?,
		processing_failure_message=?, processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND processing_status=? AND processing_claim_token=?`, status, stamp(at), message, id, ProcessingStatusProcessing, token)
	return rowsChanged(result, err, "finish processing claim")
}

func (d *DB) CommitTranscript(ctx context.Context, id, token, transcript string, segments []Segment, at time.Time) (bool, error) {
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if err := replaceSegmentsTx(tx, id, segments); err != nil {
		return false, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE meetings SET transcript=?, processing_status=?, processing_status_updated_at=?,
		processing_failure_message=NULL, processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND processing_status=? AND processing_claim_token=?`, transcript, ProcessingStatusPending, stamp(at), id, ProcessingStatusProcessing, token)
	ok, err := rowsChanged(result, err, "commit transcript")
	if err != nil || !ok {
		return ok, err
	}
	return true, tx.Commit()
}

type ProcessingCompletion struct{ Title, Transcript, Summary, ExtractionJSON string }

func (d *DB) CommitSummary(ctx context.Context, id, token string, value ProcessingCompletion, at time.Time) (bool, error) {
	result, err := d.Conn.ExecContext(ctx, `UPDATE meetings SET title=CASE WHEN trim(?)='' THEN title ELSE ? END,
		transcript=?, summary=?, extraction_json=?, processing_status=?, processing_status_updated_at=?,
		processing_failure_message=NULL, processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND processing_status=? AND processing_claim_token=?`, value.Title, value.Title, value.Transcript,
		value.Summary, value.ExtractionJSON, ProcessingStatusCompleted, stamp(at), id, ProcessingStatusProcessing, token)
	return rowsChanged(result, err, "commit summary")
}

func (d *DB) ClearAudioPath(ctx context.Context, id, expectedPath string) (bool, error) {
	result, err := d.Conn.ExecContext(ctx, `UPDATE meetings SET audio_path=NULL WHERE id=? AND processing_status=? AND audio_path=?`, id, ProcessingStatusCompleted, expectedPath)
	return rowsChanged(result, err, "clear meeting audio path")
}

func (d *DB) CompletedWithAudio(ctx context.Context) ([]Meeting, error) {
	rows, err := d.Conn.QueryContext(ctx, selectMeetingsSQL+` WHERE processing_status=? AND audio_path IS NOT NULL AND audio_path<>'' ORDER BY started_at ASC`, ProcessingStatusCompleted)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMeetings(rows)
}
