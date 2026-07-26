package db

import (
	"context"
	"database/sql"
	"time"
)

func (d *DB) CommitLiveTranscript(ctx context.Context, id, transcript string, segments []Segment, at time.Time) (bool, error) {
	if transcript == "" {
		return false, nil
	}
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	return commitLiveTranscriptTx(ctx, tx, id, transcript, segments, at)
}

func commitLiveTranscriptTx(ctx context.Context, tx *sql.Tx, id, transcript string, segments []Segment, at time.Time) (bool, error) {
	if err := replaceSegmentsTx(tx, id, segments); err != nil {
		return false, err
	}
	result, err := tx.ExecContext(ctx, commitLiveTranscriptSQL, transcript, stamp(at), id,
		CaptureStatusCaptured, ProcessingStatusPending)
	ok, err := rowsChanged(result, err, "commit Live Transcript")
	if err != nil || !ok {
		return ok, err
	}
	return true, tx.Commit()
}

func (d *DB) DiscardLiveTranscript(ctx context.Context, id string, at time.Time) (bool, error) {
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	return discardLiveTranscriptTx(ctx, tx, id, at)
}

func discardLiveTranscriptTx(ctx context.Context, tx *sql.Tx, id string, at time.Time) (bool, error) {
	result, err := tx.ExecContext(ctx, discardLiveTranscriptSQL, stamp(at), id,
		CaptureStatusRecording, ProcessingStatusNotStarted,
		CaptureStatusCaptured, ProcessingStatusPending,
		CaptureStatusFailed, ProcessingStatusNotStarted)
	ok, err := rowsChanged(result, err, "discard Live Transcript")
	if err != nil || !ok {
		return ok, err
	}
	if _, err := tx.ExecContext(ctx, deleteSegmentsSQL, id); err != nil {
		return false, err
	}
	if err := incrementTranscriptRevision(tx, id); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

const commitLiveTranscriptSQL = `UPDATE meetings SET transcript=?, processing_status_updated_at=?
	WHERE id=? AND capture_status=? AND processing_status=? AND transcript IS NULL`

const discardLiveTranscriptSQL = `UPDATE meetings SET processing_status_updated_at=?
	WHERE id=? AND ((capture_status=? AND processing_status=?) OR (capture_status=? AND processing_status=?)
		OR (capture_status=? AND processing_status=?)) AND transcript IS NULL`
