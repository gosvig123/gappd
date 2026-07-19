package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDiarizationMigrationBacksUpWALAndCleansUpOnLaterHealthyStartup(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "gappd.db")
	legacy := openFileDB(t, dbPath)
	defer legacy.Close()
	migrationExec(t, legacy, `PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
		CREATE TABLE meetings (id TEXT PRIMARY KEY,title TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,
			audio_path TEXT,transcript TEXT,summary TEXT,tags TEXT NOT NULL DEFAULT '[]',source TEXT NOT NULL DEFAULT 'manual',
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
		CREATE TABLE segments (id TEXT PRIMARY KEY,meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
			start_sec REAL NOT NULL,end_sec REAL NOT NULL,text TEXT NOT NULL,speaker TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
		PRAGMA wal_checkpoint(TRUNCATE)`)
	migrationExec(t, legacy, `INSERT INTO meetings
		(id,title,started_at,ended_at,audio_path,transcript,summary)
		VALUES ('m1','Legacy','2026-01-01','2026-01-02','audio.wav','hello','summary')`)
	store := openFileDB(t, dbPath)
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	backupPath := dbPath + diarizationBackupSuffix
	backup, err := sql.Open("sqlite", backupPath)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var transcript string
	if err := backup.QueryRow(`SELECT transcript FROM meetings WHERE id='m1'`).Scan(&transcript); err != nil || transcript != "hello" {
		t.Fatalf("backup WAL transcript = %q, %v", transcript, err)
	}
	backupColumns, err := tableColumns(t.Context(), backup, "meetings")
	if err != nil || backupColumns["diarization_state"] {
		t.Fatalf("backup was not pre-migration: columns=%v err=%v", backupColumns, err)
	}

	var state string
	var transcriptRevision, summaryRevision, backlog int
	if err := store.Conn.QueryRow(`SELECT diarization_state,transcript_revision,summary_transcript_revision,
		(SELECT count(*) FROM meetings WHERE diarization_state<>'not_requested') FROM meetings WHERE id='m1'`).
		Scan(&state, &transcriptRevision, &summaryRevision, &backlog); err != nil {
		t.Fatal(err)
	}
	if state != "not_requested" || transcriptRevision != 0 || summaryRevision != 0 || backlog != 0 {
		t.Fatalf("migration defaults = (%q,%d,%d), backlog=%d", state, transcriptRevision, summaryRevision, backlog)
	}
	old := time.Now().Add(-diarizationBackupMaxAge)
	if err := os.Chtimes(backupPath, old, old); err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("cleanup Init() error = %v", err)
	}
	if _, err := os.Stat(backupPath); !os.IsNotExist(err) {
		t.Fatalf("aged backup still exists: %v", err)
	}
}

func migrationExec(t *testing.T, store *DB, query string) {
	t.Helper()
	if _, err := store.Conn.Exec(query); err != nil {
		t.Fatal(err)
	}
}
