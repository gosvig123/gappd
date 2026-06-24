package db

import "testing"

func TestDeleteMeetingRemovesMeetingAndSegments(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := savedMeeting(t, store, CaptureStatusCaptured, ProcessingStatusCompleted)
	if err := store.InsertSegment(&Segment{MeetingID: meeting.ID, Start: 0, End: 1, Text: "hello", Speaker: "You"}); err != nil {
		t.Fatalf("InsertSegment() error = %v", err)
	}
	deleted, err := store.DeleteMeeting(meeting.ID)
	if err != nil {
		t.Fatalf("DeleteMeeting() error = %v", err)
	}
	if deleted.ID != meeting.ID {
		t.Fatalf("deleted.ID = %q, want %q", deleted.ID, meeting.ID)
	}
	if _, err := store.GetMeeting(meeting.ID); err == nil {
		t.Fatal("GetMeeting() error = nil after delete")
	}
	segments, err := store.GetSegments(meeting.ID)
	if err != nil || len(segments) != 0 {
		t.Fatalf("GetSegments() = %d, %v; want 0, nil", len(segments), err)
	}
}

func TestDeleteMeetingBlocksActiveMeetings(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	cases := []struct {
		name       string
		capture    CaptureStatus
		processing ProcessingStatus
	}{
		{"recording", CaptureStatusRecording, ProcessingStatusNotStarted},
		{"processing", CaptureStatusCaptured, ProcessingStatusProcessing},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			meeting := savedMeeting(t, store, tc.capture, tc.processing)
			if _, err := store.DeleteMeeting(meeting.ID); err == nil {
				t.Fatal("DeleteMeeting() error = nil")
			}
		})
	}
}

func savedMeeting(t *testing.T, store *DB, capture CaptureStatus, processing ProcessingStatus) *Meeting {
	t.Helper()
	at := "2026-04-10T12:00:00Z"
	meeting := &Meeting{Title: "Delete me", StartedAt: at, CaptureStatus: capture, CaptureStatusUpdatedAt: at, ProcessingStatus: processing, ProcessingStatusUpdatedAt: at, Tags: "[]", Source: "listen"}
	if err := store.CreateMeeting(meeting); err != nil {
		t.Fatalf("CreateMeeting() error = %v", err)
	}
	return meeting
}
