package db

import "testing"

func TestInitUpgradesExistingMeetingsLifecycle(t *testing.T) {
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	_, err = store.Conn.Exec(`CREATE TABLE meetings (
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
		t.Fatalf("create old meetings table: %v", err)
	}
	_, err = store.Conn.Exec(`INSERT INTO meetings (id, title, started_at, ended_at, transcript, summary, tags, source) VALUES
		('completed-1', 'Done', '2026-04-10T09:00:00Z', '2026-04-10T10:00:00Z', 'Transcript', 'Summary', '[]', 'listen'),
		('failed-1', 'Partial', '2026-04-10T11:00:00Z', '2026-04-10T12:00:00Z', 'Transcript', NULL, '[]', 'listen'),
		('recording-1', 'Live', '2026-04-10T13:00:00Z', NULL, NULL, NULL, '[]', 'listen')`)
	if err != nil {
		t.Fatalf("insert old meetings: %v", err)
	}

	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}

	assertMeetingLifecycle(t, store, "completed-1", CaptureStatusCaptured, ProcessingStatusCompleted)
	assertMeetingLifecycle(t, store, "failed-1", CaptureStatusCaptured, ProcessingStatusFailed)
	assertMeetingLifecycle(t, store, "recording-1", CaptureStatusRecording, ProcessingStatusNotStarted)
}

func TestInitPreservesExistingStatusWhenOnlyTimestampNeedsBackfill(t *testing.T) {
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	_, err = store.Conn.Exec(`CREATE TABLE meetings (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		started_at TEXT NOT NULL,
		ended_at TEXT,
		status TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'completed', 'failed')),
		status_updated_at TEXT NOT NULL DEFAULT '',
		failure_message TEXT,
		capture_status TEXT NOT NULL DEFAULT 'recording' CHECK (capture_status IN ('recording', 'captured', 'failed')),
		capture_status_updated_at TEXT NOT NULL DEFAULT '',
		capture_failure_message TEXT,
		processing_status TEXT NOT NULL DEFAULT 'not_started' CHECK (processing_status IN ('not_started', 'processing', 'completed', 'failed')),
		processing_status_updated_at TEXT NOT NULL DEFAULT '',
		processing_failure_message TEXT,
		audio_path TEXT,
		transcript TEXT,
		summary TEXT,
		tags TEXT NOT NULL DEFAULT '[]',
		source TEXT NOT NULL DEFAULT 'manual',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
	)`)
	if err != nil {
		t.Fatalf("create partially upgraded meetings table: %v", err)
	}
	_, err = store.Conn.Exec(`INSERT INTO meetings (id, title, started_at, ended_at, status, status_updated_at, transcript, summary, tags, source) VALUES
		('processing-1', 'Queued', '2026-04-10T14:00:00Z', '2026-04-10T14:15:00Z', 'processing', '', 'Transcript', NULL, '[]', 'listen')`)
	if err != nil {
		t.Fatalf("insert partially upgraded meeting: %v", err)
	}

	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}

	meeting, err := store.GetMeeting("processing-1")
	if err != nil {
		t.Fatalf("GetMeeting(processing-1) error = %v", err)
	}
	if meeting.CaptureStatus != CaptureStatusCaptured || meeting.ProcessingStatus != ProcessingStatusProcessing {
		t.Fatalf("status = (%q,%q), want (%q,%q)", meeting.CaptureStatus, meeting.ProcessingStatus, CaptureStatusCaptured, ProcessingStatusProcessing)
	}
	if meeting.ProcessingStatusUpdatedAt != "2026-04-10T14:15:00Z" {
		t.Fatalf("processing_status_updated_at = %q", meeting.ProcessingStatusUpdatedAt)
	}
}

func TestInitDoesNotBackfillFailedEndedMeetingAsCapturedWithoutArtifacts(t *testing.T) {
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	_, err = store.Conn.Exec(`CREATE TABLE meetings (
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
		t.Fatalf("create old meetings table: %v", err)
	}
	_, err = store.Conn.Exec(`INSERT INTO meetings (id, title, started_at, ended_at, transcript, summary, tags, source) VALUES
		('failed-no-artifacts', 'Legacy failed', '2026-04-10T15:00:00Z', '2026-04-10T15:30:00Z', NULL, NULL, '[]', 'listen')`)
	if err != nil {
		t.Fatalf("insert old failed meeting: %v", err)
	}

	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	assertMeetingLifecycle(t, store, "failed-no-artifacts", CaptureStatusFailed, ProcessingStatusFailed)
}

func assertMeetingLifecycle(t *testing.T, store *DB, id string, capture CaptureStatus, processing ProcessingStatus) {
	t.Helper()
	meeting, err := store.GetMeeting(id)
	if err != nil {
		t.Fatalf("GetMeeting(%s) error = %v", id, err)
	}
	if meeting.CaptureStatus != capture || meeting.ProcessingStatus != processing {
		t.Fatalf("meeting %s status = (%q,%q), want (%q,%q)", id, meeting.CaptureStatus, meeting.ProcessingStatus, capture, processing)
	}
}
