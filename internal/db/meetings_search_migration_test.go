package db

import (
	"path/filepath"
	"testing"
)

const legacySearchUpdateTrigger = `CREATE TRIGGER meetings_au AFTER UPDATE ON meetings BEGIN
	INSERT INTO meetings_fts(meetings_fts,rowid,title,transcript,summary)
	VALUES('delete',old.rowid,old.title,old.transcript,old.summary);
	INSERT INTO meetings_fts(rowid,title,transcript,summary)
	VALUES(new.rowid,new.title,new.transcript,new.summary);
END;`

func installLegacySearchTrigger(t *testing.T, store *DB) {
	t.Helper()
	migrationExec(t, store, `DELETE FROM migrations WHERE name='meetings_search_changed_values';
		DROP TRIGGER meetings_au;`+legacySearchUpdateTrigger)
}

func TestMeetingsSearchMigratesInstalledTriggerWithoutRebuild(t *testing.T) {
	store := newSearchTestDB(t)
	seedSearchMeeting(t, store)
	installLegacySearchTrigger(t, store)
	before := searchTotalChanges(t, store)
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	if changes := searchTotalChanges(t, store) - before; changes != 1 {
		t.Fatalf("trigger migration wrote %d rows; want only the migration record", changes)
	}
	before = searchTotalChanges(t, store)
	migrationExec(t, store, `UPDATE meetings SET processing_claim_token='claim'`)
	if changes := searchTotalChanges(t, store) - before; changes != 1 {
		t.Fatalf("migrated trigger wrote %d rows for a claim update", changes)
	}
	assertSearchCount(t, store, "Original", 1)
}

func TestMeetingsSearchCreatesMissingIndexForExistingMeetings(t *testing.T) {
	store := newSearchTestDB(t)
	seedSearchMeeting(t, store)
	migrationExec(t, store, `DROP TRIGGER meetings_ai; DROP TRIGGER meetings_ad;
		DROP TRIGGER meetings_au; DROP TABLE meetings_fts`)
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	assertSearchCount(t, store, "Original", 1)
	migrationExec(t, store, `INSERT INTO meetings_fts(meetings_fts,rank) VALUES('integrity-check',1)`)
}

func TestMeetingsSearchRebuildsAfterLegacyTableReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	seedLegacyMeetingsDB(t, path)
	store := openFileDB(t, path)
	defer store.Close()
	migrationExec(t, store, `INSERT INTO meetings(rowid,id,title,started_at,transcript,summary)
		VALUES(42,'m','Original','2026-01-01','Words','Overview');
		CREATE VIRTUAL TABLE meetings_fts USING fts5(title,transcript,summary,content='meetings',content_rowid='rowid');
		INSERT INTO meetings_fts(meetings_fts) VALUES('rebuild')`)
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	assertSearchCount(t, store, "Original Words Overview", 1)
	migrationExec(t, store, `INSERT INTO meetings_fts(meetings_fts,rank) VALUES('integrity-check',1)`)
	migrationExec(t, store, `UPDATE meetings SET title='Renamed'`)
	assertSearchCount(t, store, "Original", 0)
	assertSearchCount(t, store, "Renamed", 1)
}

func TestMeetingsSearchMigrationRollsBackOnFailure(t *testing.T) {
	store := newSearchTestDB(t)
	seedSearchMeeting(t, store)
	installLegacySearchTrigger(t, store)
	migrationExec(t, store, `CREATE TRIGGER reject_search_migration BEFORE INSERT ON migrations
		BEGIN SELECT RAISE(ABORT,'reject migration'); END`)
	if err := store.Init(); err == nil {
		t.Fatal("Init succeeded despite rejected migration record")
	}
	var trigger string
	if err := store.Conn.QueryRow(`SELECT sql FROM sqlite_master WHERE name='meetings_au'`).Scan(&trigger); err != nil {
		t.Fatal(err)
	}
	if trigger+";" != legacySearchUpdateTrigger {
		t.Fatalf("failed migration did not restore the old trigger: %s", trigger)
	}
	migrationExec(t, store, `DROP TRIGGER reject_search_migration`)
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	assertSearchCount(t, store, "Original", 1)
}
