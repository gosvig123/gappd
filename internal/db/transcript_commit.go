package db

import (
	"context"
	"time"
)

// CommitDirectTranscript supports the synchronous recording path. A nil
// segments value promotes existing provisional live segments; a non-nil value
// replaces them in the same transaction as publishing the transcript.
func (d *DB) CommitDirectTranscript(ctx context.Context, id, transcript string, segments []Segment, at time.Time) (bool, error) {
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if segments != nil {
		if err := replaceSegmentsTx(tx, id, segments); err != nil {
			return false, err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE meetings SET transcript=?, processing_status=?, processing_status_updated_at=?,
		processing_failure_message=NULL, processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND processing_status=? AND processing_claim_token IS NULL`, transcript, ProcessingStatusPending, stamp(at), id, ProcessingStatusProcessing)
	ok, err := rowsChanged(result, err, "commit direct transcript")
	if err != nil || !ok {
		return ok, err
	}
	return true, tx.Commit()
}
