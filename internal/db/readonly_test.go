package db

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenReadOnlyReadsAndRejectsWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gappd.sqlite")
	seedReadOnlyDB(t, path)
	store, err := OpenReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	assertReadOnlyQuery(t, store)
	if _, err := store.Conn.Exec(`UPDATE meetings SET title='Changed'`); err == nil || !strings.Contains(strings.ToLower(err.Error()), "readonly") {
		t.Fatalf("write error = %v, want readonly", err)
	}
	if store.Conn.Stats().MaxOpenConnections != 1 {
		t.Fatalf("MaxOpenConnections = %d, want 1", store.Conn.Stats().MaxOpenConnections)
	}
}

func seedReadOnlyDB(t *testing.T, path string) {
	t.Helper()
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Conn.Exec(`INSERT INTO meetings (id, title, started_at) VALUES ('one', 'Test', '2026-01-01')`); err != nil {
		t.Fatal(err)
	}
}

func TestOpenReadOnlyRequiresExistingDatabase(t *testing.T) {
	_, err := OpenReadOnly(filepath.Join(t.TempDir(), "missing.sqlite"))
	if err == nil {
		t.Fatal("OpenReadOnly() succeeded for a missing database")
	}
}

func assertReadOnlyQuery(t *testing.T, store *DB) {
	t.Helper()
	var title string
	if err := store.Conn.QueryRow(`SELECT title FROM meetings WHERE id='one'`).Scan(&title); err != nil || title != "Test" {
		t.Fatalf("read title = %q, %v", title, err)
	}
	var queryOnly int
	if err := store.Conn.QueryRow(`PRAGMA query_only`).Scan(&queryOnly); err != nil || queryOnly != 1 {
		t.Fatalf("query_only = %d, %v", queryOnly, err)
	}
}
