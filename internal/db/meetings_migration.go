package db

import (
	"context"
	"database/sql"
	"fmt"
)

func (d *DB) upgradeMeetingsLifecycle(ctx context.Context, conn *sql.Conn) error {
	columns, err := tableColumns(ctx, conn, "meetings")
	if err != nil {
		return err
	}
	needsStatusBackfill := !columns["status"]
	needsStatusUpdatedAtBackfill := !columns["status_updated_at"]
	needsCaptureStatusBackfill := !columns["capture_status"]
	needsCaptureStatusUpdatedAtBackfill := !columns["capture_status_updated_at"]
	needsCaptureFailureBackfill := !columns["capture_failure_message"]
	needsProcessingStatusBackfill := !columns["processing_status"]
	needsProcessingStatusUpdatedAtBackfill := !columns["processing_status_updated_at"]
	needsProcessingFailureBackfill := !columns["processing_failure_message"]

	if needsStatusBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN status TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'completed', 'failed'))`)
		if err != nil {
			return fmt.Errorf("add meetings.status: %w", err)
		}
	}
	if needsStatusUpdatedAtBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN status_updated_at TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return fmt.Errorf("add meetings.status_updated_at: %w", err)
		}
	}
	if !columns["failure_message"] {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN failure_message TEXT`)
		if err != nil {
			return fmt.Errorf("add meetings.failure_message: %w", err)
		}
	}
	if needsCaptureStatusBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN capture_status TEXT NOT NULL DEFAULT 'recording' CHECK (capture_status IN ('recording', 'captured', 'failed'))`)
		if err != nil {
			return fmt.Errorf("add meetings.capture_status: %w", err)
		}
	}
	if needsCaptureStatusUpdatedAtBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN capture_status_updated_at TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return fmt.Errorf("add meetings.capture_status_updated_at: %w", err)
		}
	}
	if needsCaptureFailureBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN capture_failure_message TEXT`)
		if err != nil {
			return fmt.Errorf("add meetings.capture_failure_message: %w", err)
		}
	}
	if needsProcessingStatusBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'not_started' CHECK (processing_status IN ('not_started', 'processing', 'completed', 'failed'))`)
		if err != nil {
			return fmt.Errorf("add meetings.processing_status: %w", err)
		}
	}
	if needsProcessingStatusUpdatedAtBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN processing_status_updated_at TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			return fmt.Errorf("add meetings.processing_status_updated_at: %w", err)
		}
	}
	if needsProcessingFailureBackfill {
		_, err = conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN processing_failure_message TEXT`)
		if err != nil {
			return fmt.Errorf("add meetings.processing_failure_message: %w", err)
		}
	}

	statusQuery := `UPDATE meetings
		SET status = CASE
			WHEN summary IS NOT NULL AND summary <> '' THEN 'completed'
			WHEN transcript IS NOT NULL AND transcript <> '' THEN 'failed'
			WHEN ended_at IS NOT NULL AND ended_at <> '' THEN 'failed'
			ELSE 'recording'
		END`
	if !needsStatusBackfill {
		statusQuery += ` WHERE status IS NULL OR status = ''`
	}
	if _, err := conn.ExecContext(ctx, statusQuery); err != nil {
		return fmt.Errorf("backfill meetings.status: %w", err)
	}

	statusUpdatedAtQuery := `UPDATE meetings
		SET status_updated_at = CASE
			WHEN ended_at IS NOT NULL AND ended_at <> '' THEN ended_at
			ELSE started_at
		END`
	if !needsStatusUpdatedAtBackfill {
		statusUpdatedAtQuery += ` WHERE status_updated_at IS NULL OR status_updated_at = ''`
	}
	if _, err := conn.ExecContext(ctx, statusUpdatedAtQuery); err != nil {
		return fmt.Errorf("backfill meetings.status_updated_at: %w", err)
	}

	captureStatusQuery := `UPDATE meetings
		SET capture_status = CASE
			WHEN status = 'failed' AND (ended_at IS NULL OR ended_at = '') AND (transcript IS NULL OR transcript = '') THEN 'failed'
			WHEN status IN ('processing', 'completed') THEN 'captured'
			WHEN status = 'failed' AND (
				(audio_path IS NOT NULL AND audio_path <> '') OR
				(transcript IS NOT NULL AND transcript <> '') OR
				(summary IS NOT NULL AND summary <> '')
			) THEN 'captured'
			WHEN status = 'failed' THEN 'failed'
			ELSE 'recording'
		END`
	if !needsCaptureStatusBackfill {
		captureStatusQuery += ` WHERE capture_status IS NULL OR capture_status = '' OR (capture_status = 'recording' AND status <> 'recording')`
	}
	if _, err := conn.ExecContext(ctx, captureStatusQuery); err != nil {
		return fmt.Errorf("backfill meetings.capture_status: %w", err)
	}

	captureUpdatedAtQuery := `UPDATE meetings
		SET capture_status_updated_at = CASE
			WHEN capture_status = 'recording' THEN started_at
			WHEN ended_at IS NOT NULL AND ended_at <> '' THEN ended_at
			WHEN status_updated_at IS NOT NULL AND status_updated_at <> '' THEN status_updated_at
			ELSE started_at
		END`
	if !needsCaptureStatusUpdatedAtBackfill {
		captureUpdatedAtQuery += ` WHERE capture_status_updated_at IS NULL OR capture_status_updated_at = ''`
	}
	if _, err := conn.ExecContext(ctx, captureUpdatedAtQuery); err != nil {
		return fmt.Errorf("backfill meetings.capture_status_updated_at: %w", err)
	}

	captureFailureQuery := `UPDATE meetings
		SET capture_failure_message = CASE
			WHEN status = 'failed' AND (ended_at IS NULL OR ended_at = '') AND (transcript IS NULL OR transcript = '') THEN failure_message
			ELSE capture_failure_message
		END`
	if !needsCaptureFailureBackfill {
		captureFailureQuery += ` WHERE capture_failure_message IS NULL OR capture_failure_message = ''`
	}
	if _, err := conn.ExecContext(ctx, captureFailureQuery); err != nil {
		return fmt.Errorf("backfill meetings.capture_failure_message: %w", err)
	}

	processingStatusQuery := `UPDATE meetings
		SET processing_status = CASE
			WHEN status = 'processing' THEN 'processing'
			WHEN status = 'completed' THEN 'completed'
			WHEN status = 'failed' AND (ended_at IS NOT NULL AND ended_at <> '') THEN 'failed'
			ELSE 'not_started'
		END`
	if !needsProcessingStatusBackfill {
		processingStatusQuery += ` WHERE processing_status IS NULL OR processing_status = '' OR (processing_status = 'not_started' AND status IN ('processing', 'completed', 'failed'))`
	}
	if _, err := conn.ExecContext(ctx, processingStatusQuery); err != nil {
		return fmt.Errorf("backfill meetings.processing_status: %w", err)
	}

	processingUpdatedAtQuery := `UPDATE meetings
		SET processing_status_updated_at = CASE
			WHEN processing_status = 'not_started' THEN started_at
			WHEN status_updated_at IS NOT NULL AND status_updated_at <> '' THEN status_updated_at
			WHEN ended_at IS NOT NULL AND ended_at <> '' THEN ended_at
			ELSE started_at
		END`
	if !needsProcessingStatusUpdatedAtBackfill {
		processingUpdatedAtQuery += ` WHERE processing_status_updated_at IS NULL OR processing_status_updated_at = ''`
	}
	if _, err := conn.ExecContext(ctx, processingUpdatedAtQuery); err != nil {
		return fmt.Errorf("backfill meetings.processing_status_updated_at: %w", err)
	}

	processingFailureQuery := `UPDATE meetings
		SET processing_failure_message = CASE
			WHEN status = 'failed' AND (ended_at IS NOT NULL AND ended_at <> '') THEN failure_message
			ELSE processing_failure_message
		END`
	if !needsProcessingFailureBackfill {
		processingFailureQuery += ` WHERE processing_failure_message IS NULL OR processing_failure_message = ''`
	}
	if _, err := conn.ExecContext(ctx, processingFailureQuery); err != nil {
		return fmt.Errorf("backfill meetings.processing_failure_message: %w", err)
	}
	return nil
}

func (d *DB) tableColumns(name string) (map[string]bool, error) {
	return tableColumns(context.Background(), d.Conn, name)
}

type tableInfoQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func tableColumns(ctx context.Context, queryer tableInfoQueryer, name string) (map[string]bool, error) {
	rows, err := queryer.QueryContext(ctx, `PRAGMA table_info(`+name+`)`)
	if err != nil {
		return nil, fmt.Errorf("table info %s: %w", name, err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var columnName string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return nil, fmt.Errorf("scan table info %s: %w", name, err)
		}
		columns[columnName] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read table info %s: %w", name, err)
	}
	return columns, nil
}
