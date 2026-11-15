package db

import (
	"context"
	"database/sql"
	"fmt"
)

// personFactRunsExist tells whether Person facts were installed before this start.
func personFactRunsExist(ctx context.Context, conn *sql.Conn) (bool, error) {
	var count int
	if err := conn.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='person_fact_runs'`).Scan(&count); err != nil {
		return false, fmt.Errorf("check person fact runs: %w", err)
	}
	return count > 0, nil
}

// skipEarlierMeetings marks every Meeting saved before Person facts as skipped, so only new
// Meetings are read automatically. A Meeting processed again later is read then.
func skipEarlierMeetings(ctx context.Context, conn *sql.Conn) error {
	_, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO person_fact_runs(meeting_id, transcript_revision, state, updated_at)
SELECT id, transcript_revision, 'skipped', strftime('%Y-%m-%dT%H:%M:%SZ','now') FROM meetings`)
	if err != nil {
		return fmt.Errorf("mark earlier meetings for person facts: %w", err)
	}
	return nil
}
