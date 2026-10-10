package db

import (
	"path/filepath"
	"testing"
)

func newSearchTestDB(t *testing.T) *DB {
	t.Helper()
	store := openFileDB(t, filepath.Join(t.TempDir(), "search.db"))
	store.Conn.SetMaxOpenConns(1)
	t.Cleanup(func() { store.Close() })
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	return store
}

func seedSearchMeeting(t *testing.T, store *DB) {
	t.Helper()
	migrationExec(t, store, `INSERT INTO meetings(id,title,started_at,capture_status,
		capture_status_updated_at,capture_failure_message,processing_status,
		processing_status_updated_at,processing_failure_message)
		VALUES('m','Original','2026-01-01','captured','2026-01-01','old capture failure',
		'completed','2026-01-01','old processing failure')`)
}

func searchTotalChanges(t *testing.T, store *DB) int {
	t.Helper()
	var changes int
	if err := store.Conn.QueryRow(`SELECT total_changes()`).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	return changes
}

func assertSearchCount(t *testing.T, store *DB, term string, want int) {
	t.Helper()
	var count int
	err := store.Conn.QueryRow(`SELECT count(*) FROM meetings_fts
		JOIN meetings ON meetings.rowid=meetings_fts.rowid WHERE meetings_fts MATCH ?`, term).Scan(&count)
	if err != nil || count != want {
		t.Fatalf("search %q = %d, %v; want %d", term, count, err, want)
	}
}

func TestMeetingsSearchSkipsUnchangedValues(t *testing.T) {
	store := newSearchTestDB(t)
	seedSearchMeeting(t, store)
	for _, query := range []string{
		`UPDATE meetings SET processing_claim_token='claim',processing_claim_expires_at='2026-01-02'`,
		`UPDATE meetings SET title=title,transcript=NULL,summary=NULL`,
		`UPDATE meetings SET transcript='Words',summary='Overview'`,
		`UPDATE meetings SET transcript=transcript,summary=summary`,
	} {
		before := searchTotalChanges(t, store)
		migrationExec(t, store, query)
		if query == `UPDATE meetings SET transcript='Words',summary='Overview'` {
			continue
		}
		if changes := searchTotalChanges(t, store) - before; changes != 1 {
			t.Fatalf("unchanged search update made %d changes: %s", changes, query)
		}
	}
	assertSearchCount(t, store, "Original Words Overview", 1)
}

func TestMeetingsSearchTracksChangedValuesAndDelete(t *testing.T) {
	store := newSearchTestDB(t)
	seedSearchMeeting(t, store)
	assertSearchCount(t, store, "Original", 1)
	migrationExec(t, store, `UPDATE meetings SET title='Renamed',transcript='Words',summary='Overview'`)
	assertSearchCount(t, store, "Original", 0)
	assertSearchCount(t, store, "Renamed Words Overview", 1)
	migrationExec(t, store, `UPDATE meetings SET transcript=NULL,summary=NULL`)
	assertSearchCount(t, store, "Words OR Overview", 0)
	migrationExec(t, store, `UPDATE meetings SET rowid=42`)
	assertSearchCount(t, store, "Renamed", 1)
	migrationExec(t, store, `INSERT INTO meetings_fts(meetings_fts,rank) VALUES('integrity-check',1)`)
	migrationExec(t, store, `DELETE FROM meetings`)
	assertSearchCount(t, store, "Renamed", 0)
}

func TestMeetingsSearchTracksEachSearchColumn(t *testing.T) {
	for _, column := range []string{"title", "transcript", "summary"} {
		t.Run(column, func(t *testing.T) {
			store := newSearchTestDB(t)
			seedSearchMeeting(t, store)
			migrationExec(t, store, `UPDATE meetings SET `+column+`='Needle'`)
			assertSearchCount(t, store, "Needle", 1)
			migrationExec(t, store, `UPDATE meetings SET `+column+`=''`)
			assertSearchCount(t, store, "Needle", 0)
			if column != "title" {
				migrationExec(t, store, `UPDATE meetings SET `+column+`=NULL`)
				migrationExec(t, store, `UPDATE meetings SET `+column+`='Restored'`)
				assertSearchCount(t, store, "Restored", 1)
			}
		})
	}
}

func TestMeetingsSearchReopenDoesNotRebuild(t *testing.T) {
	store := newSearchTestDB(t)
	seedSearchMeeting(t, store)
	reopened := openFileDB(t, store.path)
	defer reopened.Close()
	reopened.Conn.SetMaxOpenConns(1)
	if err := reopened.Init(); err != nil {
		t.Fatal(err)
	}
	if changes := searchTotalChanges(t, reopened); changes != 0 {
		t.Fatalf("Init wrote %d rows on an up-to-date database", changes)
	}
	assertSearchCount(t, reopened, "Original", 1)
}
