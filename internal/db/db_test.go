package db

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestInitWaitsForLockedLegacyDB(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "grn.db")
	seedLegacyMeetingsDB(t, dbPath)

	locker := openFileDB(t, dbPath)
	defer locker.Close()

	ctx := context.Background()
	conn, err := locker.Conn.Conn(ctx)
	if err != nil {
		t.Fatalf("Conn() error = %v", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		t.Fatalf("BEGIN IMMEDIATE error = %v", err)
	}

	store := openFileDB(t, dbPath)
	defer store.Close()

	done := make(chan error, 1)
	go func() {
		done <- store.Init()
	}()

	time.Sleep(150 * time.Millisecond)
	select {
	case err := <-done:
		t.Fatalf("Init() returned before lock release: %v", err)
	default:
	}

	if _, err := conn.ExecContext(ctx, "ROLLBACK"); err != nil {
		t.Fatalf("ROLLBACK error = %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Init() error = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Init() did not complete after lock release")
	}

	columns, err := store.tableColumns("meetings")
	if err != nil {
		t.Fatalf("tableColumns() error = %v", err)
	}
	if !columns["status"] {
		t.Fatal("status column missing after Init()")
	}
	if !columns["processing_status"] {
		t.Fatal("processing_status column missing after Init()")
	}
}

func seedLegacyMeetingsDB(t *testing.T, dbPath string) {
	t.Helper()
	store := openFileDB(t, dbPath)
	defer store.Close()
	_, err := store.Conn.Exec(`CREATE TABLE meetings (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		started_at TEXT NOT NULL,
		ended_at TEXT,
		audio_path TEXT,
		transcript TEXT,
		summary TEXT,
		tags TEXT NOT NULL DEFAULT '[]',
		source TEXT NOT NULL DEFAULT 'manual',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`)
	if err != nil {
		t.Fatalf("create legacy meetings table: %v", err)
	}
}

func openFileDB(t *testing.T, dbPath string) *DB {
	t.Helper()
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	return store
}
