package db

import (
	"testing"
)

func TestMeetingLifecycleRoundTrip(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()

	meeting := &Meeting{
		Title:                     "Sprint planning",
		StartedAt:                 "2026-04-10T12:00:00Z",
		CaptureStatus:             CaptureStatusRecording,
		CaptureStatusUpdatedAt:    "2026-04-10T12:00:00Z",
		ProcessingStatus:          ProcessingStatusNotStarted,
		ProcessingStatusUpdatedAt: "2026-04-10T12:00:00Z",
		Tags:                      "[]",
		Source:                    "listen",
	}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}

	endedAt := "2026-04-10T12:30:00Z"
	failure := "enhance failed"
	transcript := "[You] hello"
	meeting.EndedAt = &endedAt
	meeting.Transcript = &transcript
	meeting.CaptureStatus = CaptureStatusCaptured
	meeting.CaptureStatusUpdatedAt = endedAt
	meeting.ProcessingStatus = ProcessingStatusFailed
	meeting.ProcessingStatusUpdatedAt = endedAt
	meeting.ProcessingFailureMessage = &failure
	if err := store.UpdateMeeting(meeting); err != nil {
		t.Fatalf("UpdateMeeting() error = %v", err)
	}

	got, err := store.GetMeeting(meeting.ID)
	if err != nil {
		t.Fatalf("GetMeeting() error = %v", err)
	}
	if got.CaptureStatus != CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", got.CaptureStatus, CaptureStatusCaptured)
	}
	if got.ProcessingStatus != ProcessingStatusFailed {
		t.Fatalf("processing_status = %q, want %q", got.ProcessingStatus, ProcessingStatusFailed)
	}
	if got.ProcessingStatusUpdatedAt != endedAt {
		t.Fatalf("processing_status_updated_at = %q, want %q", got.ProcessingStatusUpdatedAt, endedAt)
	}
	if got.ProcessingFailureMessage == nil || *got.ProcessingFailureMessage != failure {
		t.Fatalf("processing_failure_message = %v, want %q", got.ProcessingFailureMessage, failure)
	}

	meetings, err := store.ListMeetings(10)
	if err != nil {
		t.Fatalf("ListMeetings() error = %v", err)
	}
	if len(meetings) != 1 {
		t.Fatalf("len(ListMeetings()) = %d, want 1", len(meetings))
	}
	if meetings[0].CaptureStatus != CaptureStatusCaptured {
		t.Fatalf("list capture_status = %q, want %q", meetings[0].CaptureStatus, CaptureStatusCaptured)
	}
	if meetings[0].ProcessingStatus != ProcessingStatusFailed {
		t.Fatalf("list processing_status = %q, want %q", meetings[0].ProcessingStatus, ProcessingStatusFailed)
	}
}

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

	completed, err := store.GetMeeting("completed-1")
	if err != nil {
		t.Fatalf("GetMeeting(completed-1) error = %v", err)
	}
	if completed.CaptureStatus != CaptureStatusCaptured {
		t.Fatalf("completed capture_status = %q, want %q", completed.CaptureStatus, CaptureStatusCaptured)
	}
	if completed.ProcessingStatus != ProcessingStatusCompleted {
		t.Fatalf("completed processing_status = %q, want %q", completed.ProcessingStatus, ProcessingStatusCompleted)
	}

	failed, err := store.GetMeeting("failed-1")
	if err != nil {
		t.Fatalf("GetMeeting(failed-1) error = %v", err)
	}
	if failed.CaptureStatus != CaptureStatusCaptured {
		t.Fatalf("failed capture_status = %q, want %q", failed.CaptureStatus, CaptureStatusCaptured)
	}
	if failed.ProcessingStatus != ProcessingStatusFailed {
		t.Fatalf("failed processing_status = %q, want %q", failed.ProcessingStatus, ProcessingStatusFailed)
	}

	recording, err := store.GetMeeting("recording-1")
	if err != nil {
		t.Fatalf("GetMeeting(recording-1) error = %v", err)
	}
	if recording.CaptureStatus != CaptureStatusRecording {
		t.Fatalf("recording capture_status = %q, want %q", recording.CaptureStatus, CaptureStatusRecording)
	}
	if recording.CaptureStatusUpdatedAt != recording.StartedAt {
		t.Fatalf("recording capture_status_updated_at = %q, want %q", recording.CaptureStatusUpdatedAt, recording.StartedAt)
	}
	if recording.ProcessingStatus != ProcessingStatusNotStarted {
		t.Fatalf("recording processing_status = %q, want %q", recording.ProcessingStatus, ProcessingStatusNotStarted)
	}
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
	if meeting.CaptureStatus != CaptureStatusCaptured {
		t.Fatalf("capture_status = %q, want %q", meeting.CaptureStatus, CaptureStatusCaptured)
	}
	if meeting.ProcessingStatus != ProcessingStatusProcessing {
		t.Fatalf("processing_status = %q, want %q", meeting.ProcessingStatus, ProcessingStatusProcessing)
	}
	if meeting.ProcessingStatusUpdatedAt != "2026-04-10T14:15:00Z" {
		t.Fatalf("processing_status_updated_at = %q, want %q", meeting.ProcessingStatusUpdatedAt, "2026-04-10T14:15:00Z")
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

	meeting, err := store.GetMeeting("failed-no-artifacts")
	if err != nil {
		t.Fatalf("GetMeeting(failed-no-artifacts) error = %v", err)
	}
	if meeting.CaptureStatus != CaptureStatusFailed {
		t.Fatalf("capture_status = %q, want %q", meeting.CaptureStatus, CaptureStatusFailed)
	}
	if meeting.ProcessingStatus != ProcessingStatusFailed {
		t.Fatalf("processing_status = %q, want %q", meeting.ProcessingStatus, ProcessingStatusFailed)
	}
}

func openTestDB(t *testing.T) *DB {
	t.Helper()
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err := store.Init(); err != nil {
		store.Close()
		t.Fatalf("Init() error = %v", err)
	}
	return store
}
