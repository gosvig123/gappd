package db

import "testing"

func TestUpdateMeetingMirrorsLegacyStatus(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := completedMeetingForLegacyStatus()

	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	assertLegacyStatus(t, store, meeting.ID, string(MeetingStateCompleted), meeting.ProcessingStatusUpdatedAt, nil)
}

func TestInitSyncsLegacyStatusFromLifecycleColumns(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := completedMeetingForLegacyStatus()
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	forceLegacyStatus(t, store, meeting.ID, string(MeetingStateRecording))

	if err := store.Init(); err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	assertLegacyStatus(t, store, meeting.ID, string(MeetingStateCompleted), meeting.ProcessingStatusUpdatedAt, nil)
}

func completedMeetingForLegacyStatus() *Meeting {
	return &Meeting{ID: "sync-legacy", Title: "Done", StartedAt: "2026-04-10T09:00:00Z", CaptureStatus: CaptureStatusCaptured, CaptureStatusUpdatedAt: "2026-04-10T10:00:00Z", ProcessingStatus: ProcessingStatusCompleted, ProcessingStatusUpdatedAt: "2026-04-10T10:01:00Z", Tags: "[]", Source: "listen"}
}

func forceLegacyStatus(t *testing.T, store *DB, id, status string) {
	t.Helper()
	_, err := store.Conn.Exec(`UPDATE meetings SET status=? WHERE id=?`, status, id)
	if err != nil {
		t.Fatalf("force stale legacy status: %v", err)
	}
}

func assertLegacyStatus(t *testing.T, store *DB, id, status, updatedAt string, failure *string) {
	t.Helper()
	var gotStatus, gotUpdatedAt string
	var gotFailure *string
	err := store.Conn.QueryRow(`SELECT status, status_updated_at, failure_message FROM meetings WHERE id=?`, id).Scan(&gotStatus, &gotUpdatedAt, &gotFailure)
	if err != nil {
		t.Fatalf("query legacy status: %v", err)
	}
	if gotStatus != status || gotUpdatedAt != updatedAt || stringPtrValue(gotFailure) != stringPtrValue(failure) {
		t.Fatalf("legacy status = (%q,%q,%v), want (%q,%q,%v)", gotStatus, gotUpdatedAt, gotFailure, status, updatedAt, failure)
	}
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
