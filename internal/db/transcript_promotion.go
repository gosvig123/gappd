package db

import (
	"context"
	"time"
)

// PromoteProvisionalTranscript publishes existing live segments without
// replacing them. The pending queue then advances directly to summarization.
func (d *DB) PromoteProvisionalTranscript(ctx context.Context, id, transcript string, at time.Time) (bool, error) {
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if transcript == "" {
		return false, nil
	}
	result, err := tx.ExecContext(ctx, `UPDATE meetings SET transcript=?, processing_status_updated_at=?
		WHERE id=? AND capture_status=? AND processing_status=? AND transcript IS NULL`, transcript, stamp(at), id, CaptureStatusCaptured, ProcessingStatusPending)
	ok, err := rowsChanged(result, err, "promote provisional transcript")
	if err != nil || !ok {
		return ok, err
	}
	return true, tx.Commit()
}
