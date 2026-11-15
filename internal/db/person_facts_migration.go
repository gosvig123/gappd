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

// moveHiddenPersonFacts copies the hidden choices of a beta build, which kept them in a
// person_facts.hidden column, to person_hidden_facts, and then clears the column.
func moveHiddenPersonFacts(ctx context.Context, conn *sql.Conn) error {
	var count int
	if err := conn.QueryRowContext(ctx, `SELECT count(*) FROM pragma_table_info('person_facts') WHERE name='hidden'`).Scan(&count); err != nil {
		return fmt.Errorf("check hidden person facts: %w", err)
	}
	if count == 0 {
		return nil
	}
	rows, err := conn.QueryContext(ctx, `SELECT s.person_id, f.text FROM person_facts f
JOIN meeting_speakers s ON s.meeting_id=f.meeting_id AND s.speaker_key=f.speaker_key WHERE f.hidden=1`)
	if err != nil {
		return fmt.Errorf("read hidden person facts: %w", err)
	}
	type hidden struct{ person, text string }
	var found []hidden
	for rows.Next() {
		var item hidden
		if err := rows.Scan(&item.person, &item.text); err != nil {
			rows.Close()
			return fmt.Errorf("read hidden person facts: %w", err)
		}
		found = append(found, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read hidden person facts: %w", err)
	}
	for _, item := range found {
		if _, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO person_hidden_facts(person_id, text_key) VALUES (?,?)`, item.person, factText(item.text)); err != nil {
			return fmt.Errorf("move hidden person facts: %w", err)
		}
	}
	if _, err := conn.ExecContext(ctx, `UPDATE person_facts SET hidden=0 WHERE hidden=1`); err != nil {
		return fmt.Errorf("move hidden person facts: %w", err)
	}
	return nil
}
