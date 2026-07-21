package db

import "testing"

func TestReplaceSegmentsOverwritesMeetingSegments(t *testing.T) {
	store := openTestDB(t)
	defer store.Close()
	meeting := &Meeting{
		Title:                     "Live",
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
	first := []Segment{{MeetingID: meeting.ID, Start: 0, End: 1, Speaker: "You", Text: "old"}}
	source, confidence, reason := SegmentSourceSystem, 0.8, SpeakerAssignmentReasonPendingSystemAttribution
	second := []Segment{{MeetingID: meeting.ID, Start: 1, End: 2, Speaker: "Other", Text: "new",
		SpeakerSource: &source, SpeakerConfidence: &confidence, SpeakerAssignmentReason: &reason}}
	if err := store.ReplaceSegments(meeting.ID, first); err != nil {
		t.Fatalf("ReplaceSegments(first) error = %v", err)
	}
	if err := store.ReplaceSegments(meeting.ID, second); err != nil {
		t.Fatalf("ReplaceSegments(second) error = %v", err)
	}
	segments, err := store.GetSegments(meeting.ID)
	if err != nil {
		t.Fatalf("GetSegments() error = %v", err)
	}
	if len(segments) != 1 || segments[0].Text != "new" || segments[0].Speaker != "Other" ||
		segments[0].SpeakerSource == nil || *segments[0].SpeakerSource != SegmentSourceSystem ||
		segments[0].SpeakerConfidence == nil || *segments[0].SpeakerConfidence != confidence ||
		segments[0].SpeakerAssignmentReason == nil || *segments[0].SpeakerAssignmentReason != reason {
		t.Fatalf("segments = %#v, want typed replacement provenance", segments)
	}
	stored, err := store.GetMeeting(meeting.ID)
	if err != nil || stored.TranscriptRevision != 2 {
		t.Fatalf("transcript revision = %d, %v; want 2", stored.TranscriptRevision, err)
	}
}
