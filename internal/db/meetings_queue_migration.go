package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// rebuildMeetingsQueue transactionally replaces the table because SQLite
// cannot alter the processing_status CHECK constraint in place.
func rebuildMeetingsQueue(ctx context.Context, conn *sql.Conn) error {
	current, err := meetingTableSQL(ctx, conn)
	if err != nil {
		return err
	}
	if strings.Contains(current, "processing_claim_token") && strings.Contains(current, "'pending'") {
		return nil
	}
	for _, statement := range queueRebuildStatements {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("rebuild meetings queue: %w", err)
		}
	}
	return nil
}

func meetingTableSQL(ctx context.Context, conn *sql.Conn) (string, error) {
	var value string
	err := conn.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type='table' AND name='meetings'`).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

var queueRebuildStatements = []string{
	`DROP TRIGGER IF EXISTS meetings_ai`, `DROP TRIGGER IF EXISTS meetings_ad`, `DROP TRIGGER IF EXISTS meetings_au`,
	`CREATE TABLE meetings_queue_new (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
		capture_status TEXT NOT NULL DEFAULT 'recording' CHECK (capture_status IN ('recording','captured','failed')),
		capture_status_updated_at TEXT NOT NULL DEFAULT '', capture_failure_message TEXT,
		processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processing','completed','failed')),
		processing_status_updated_at TEXT NOT NULL DEFAULT '', processing_failure_message TEXT,
		processing_claim_token TEXT, processing_claim_expires_at TEXT, audio_path TEXT,
		transcript TEXT, summary TEXT, extraction_json TEXT, language TEXT NOT NULL DEFAULT 'en_US',
		tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'manual',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
	)`,
	`INSERT INTO meetings_queue_new (id,title,started_at,ended_at,capture_status,capture_status_updated_at,
		capture_failure_message,processing_status,processing_status_updated_at,processing_failure_message,
		audio_path,transcript,summary,extraction_json,language,tags,source,created_at)
	 SELECT id,title,started_at,ended_at,capture_status,capture_status_updated_at,capture_failure_message,
		CASE WHEN processing_status IN ('not_started','processing') THEN 'pending' ELSE processing_status END,
		processing_status_updated_at,processing_failure_message,audio_path,transcript,summary,extraction_json,
		language,tags,source,created_at FROM meetings`,
	`DROP TABLE meetings`, `ALTER TABLE meetings_queue_new RENAME TO meetings`,
}
