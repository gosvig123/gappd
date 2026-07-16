package db

import (
	"context"
	"database/sql"
	"time"
)

func (d *DB) RenewClaim(ctx context.Context, id, token string, now time.Time, ttl time.Duration) (bool, error) {
	result, err := d.Conn.ExecContext(ctx, `UPDATE meetings SET processing_claim_expires_at=?, processing_status_updated_at=?
		WHERE id=? AND processing_status=? AND processing_claim_token=?`, stamp(now.Add(ttl)), stamp(now), id, ProcessingStatusProcessing, token)
	return rowsChanged(result, err, "renew processing claim")
}

func (d *DB) CommitClaim(ctx context.Context, meeting *Meeting, token string) (bool, error) {
	return commitClaim(ctx, d.Conn, meeting, token)
}

func (d *DB) CommitClaimTranscript(ctx context.Context, meeting *Meeting, token string, segments []Segment) (bool, error) {
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if err := replaceSegmentsTx(tx, meeting.ID, segments); err != nil {
		return false, err
	}
	ok, err := commitClaim(ctx, tx, meeting, token)
	if err != nil || !ok {
		return ok, err
	}
	return true, tx.Commit()
}

type claimExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func commitClaim(ctx context.Context, exec claimExecer, meeting *Meeting, token string) (bool, error) {
	result, err := exec.ExecContext(ctx, commitClaimSQL, claimArgs(meeting, token)...)
	return rowsChanged(result, err, "commit processing claim")
}

func claimArgs(meeting *Meeting, token string) []any {
	return []any{meeting.Title, meeting.Transcript, meeting.Summary, meeting.ExtractionJSON,
		meeting.ProcessingStatus, meeting.ProcessingStatusUpdatedAt, meeting.ProcessingFailureMessage,
		meeting.ID, ProcessingStatusProcessing, token}
}

const commitClaimSQL = `UPDATE meetings SET title=?, transcript=?, summary=?, extraction_json=?,
	processing_status=?, processing_status_updated_at=?, processing_failure_message=?,
	processing_claim_token=NULL, processing_claim_expires_at=NULL
	WHERE id=? AND processing_status=? AND processing_claim_token=?`
