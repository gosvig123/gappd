package db

import "testing"

func TestQueueMigrationPreservesSegmentsForeignKeyAndFTS(t *testing.T) {
	store, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, err = store.Conn.Exec(`CREATE TABLE meetings (
		id TEXT PRIMARY KEY,title TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,
		capture_status TEXT NOT NULL DEFAULT 'recording' CHECK(capture_status IN ('recording','captured','failed')),
		capture_status_updated_at TEXT NOT NULL DEFAULT '',capture_failure_message TEXT,
		processing_status TEXT NOT NULL DEFAULT 'not_started' CHECK(processing_status IN ('not_started','processing','completed','failed')),
		processing_status_updated_at TEXT NOT NULL DEFAULT '',processing_failure_message TEXT,audio_path TEXT,
		transcript TEXT,summary TEXT,extraction_json TEXT,language TEXT NOT NULL DEFAULT 'en_US',tags TEXT NOT NULL DEFAULT '[]',
		source TEXT NOT NULL DEFAULT 'manual',created_at TEXT NOT NULL DEFAULT '')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Conn.Exec(`CREATE TABLE segments (id TEXT PRIMARY KEY,meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
		start_sec REAL NOT NULL,end_sec REAL NOT NULL,text TEXT NOT NULL,speaker TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT '');
		INSERT INTO meetings(id,title,started_at,capture_status,capture_status_updated_at,processing_status,processing_status_updated_at)
		VALUES('m','Old','2026-01-01','captured','2026-01-01','processing','2026-01-01');
		INSERT INTO segments(id,meeting_id,start_sec,end_sec,text) VALUES('s','m',0,1,'hello')`)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	meeting, err := store.GetMeeting("m")
	if err != nil || meeting.ProcessingStatus != ProcessingStatusPending {
		t.Fatalf("meeting = %#v, %v", meeting, err)
	}
	segments, err := store.GetSegments("m")
	if err != nil || len(segments) != 1 {
		t.Fatalf("segments = %#v, %v", segments, err)
	}
	if _, err := store.Conn.Exec(`INSERT INTO segments(id,meeting_id,start_sec,end_sec,text) VALUES('bad','missing',0,1,'x')`); err == nil {
		t.Fatal("segments foreign key not enforced after migration")
	}
	if _, err := store.Conn.Exec(`UPDATE meetings SET title='Searchable' WHERE id='m'`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := store.Conn.QueryRow(`SELECT count(*) FROM meetings_fts WHERE meetings_fts MATCH 'Searchable'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("fts count = %d, %v", count, err)
	}
}
