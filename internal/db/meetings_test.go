package db

import "testing"

func TestMeetingLifecycleRoundTrip(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := lifecycleRoundTripMeeting()
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}

	endedAt := *meeting.EndedAt
	failure := *meeting.ProcessingFailureMessage
	extractionJSON := *meeting.ExtractionJSON
	assertStoredLifecycleRoundTrip(t, store, meeting.ID, endedAt, failure, extractionJSON)
	meetings, err := store.ListMeetings(10)
	if err != nil {
		t.Fatalf("ListMeetings() error = %v", err)
	}
	assertListedLifecycleRoundTrip(t, meetings)
}

func lifecycleRoundTripMeeting() *Meeting {
	endedAt := "2026-04-10T12:30:00Z"
	failure := "enhance failed"
	transcript := "[You] hello"
	extractionJSON := `{"title":"Sprint planning"}`
	return &Meeting{
		Title: "Sprint planning", StartedAt: "2026-04-10T12:00:00Z", EndedAt: &endedAt,
		CaptureStatus: CaptureStatusCaptured, CaptureStatusUpdatedAt: endedAt,
		ProcessingStatus: ProcessingStatusFailed, ProcessingStatusUpdatedAt: endedAt,
		ProcessingFailureMessage: &failure, Transcript: &transcript, ExtractionJSON: &extractionJSON,
		Tags: "[]", Source: "listen",
	}
}

func assertStoredLifecycleRoundTrip(t *testing.T, store *DB, id, endedAt, failure, extractionJSON string) {
	t.Helper()
	got, err := store.GetMeeting(id)
	if err != nil {
		t.Fatalf("GetMeeting() error = %v", err)
	}
	if got.CaptureStatus != CaptureStatusCaptured || got.ProcessingStatus != ProcessingStatusFailed {
		t.Fatalf("status = (%q,%q), want (%q,%q)", got.CaptureStatus, got.ProcessingStatus, CaptureStatusCaptured, ProcessingStatusFailed)
	}
	if got.ProcessingStatusUpdatedAt != endedAt {
		t.Fatalf("processing_status_updated_at = %q, want %q", got.ProcessingStatusUpdatedAt, endedAt)
	}
	if got.ProcessingFailureMessage == nil || *got.ProcessingFailureMessage != failure {
		t.Fatalf("processing_failure_message = %v, want %q", got.ProcessingFailureMessage, failure)
	}
	if got.ExtractionJSON == nil || *got.ExtractionJSON != extractionJSON {
		t.Fatalf("extraction_json = %v, want %q", got.ExtractionJSON, extractionJSON)
	}
}

func assertListedLifecycleRoundTrip(t *testing.T, meetings []Meeting) {
	t.Helper()
	if len(meetings) != 1 {
		t.Fatalf("len(ListMeetings()) = %d, want 1", len(meetings))
	}
	if meetings[0].CaptureStatus != CaptureStatusCaptured || meetings[0].ProcessingStatus != ProcessingStatusFailed {
		t.Fatalf("list status = (%q,%q), want (%q,%q)", meetings[0].CaptureStatus, meetings[0].ProcessingStatus, CaptureStatusCaptured, ProcessingStatusFailed)
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
