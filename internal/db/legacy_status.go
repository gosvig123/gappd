package db

import (
	"context"
	"database/sql"
	"fmt"
)

func syncLegacyMeetingStatus(ctx context.Context, conn *sql.Conn) error {
	_, err := conn.ExecContext(ctx, legacyMeetingStatusSyncSQL)
	if err != nil {
		return fmt.Errorf("sync legacy meetings.status: %w", err)
	}
	return nil
}

const legacyMeetingStatusSyncSQL = `UPDATE meetings SET
	status = CASE
		WHEN capture_status = 'failed' THEN 'failed'
		WHEN capture_status = 'recording' THEN 'recording'
		WHEN processing_status = 'failed' THEN 'failed'
		WHEN processing_status = 'completed' THEN 'completed'
		ELSE 'processing'
	END,
	status_updated_at = CASE
		WHEN processing_status IN ('failed', 'processing', 'completed') AND processing_status_updated_at <> '' THEN processing_status_updated_at
		WHEN capture_status_updated_at <> '' THEN capture_status_updated_at
		ELSE started_at
	END,
	failure_message = CASE
		WHEN capture_status = 'failed' THEN capture_failure_message
		WHEN processing_status = 'failed' THEN processing_failure_message
		ELSE NULL
	END`
