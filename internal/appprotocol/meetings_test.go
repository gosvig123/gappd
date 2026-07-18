package appprotocol

import (
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestMeetingDetailShowsOnlyValidLiveTranscriptSegments(t *testing.T) {
	segments := []db.Segment{{MeetingID: "m", Start: 0, End: 1, Speaker: "You", Text: "hello"}}
	recording := transcriptMeeting(db.CaptureStatusRecording, db.ProcessingStatusNotStarted, nil)
	live := BuildMeetingDetail(recording, segments)
	if !live.TranscriptProvisional || len(live.Segments) != 1 || live.TranscriptText == "" {
		t.Fatalf("recording detail = %+v", live)
	}
	captured := transcriptMeeting(db.CaptureStatusCaptured, db.ProcessingStatusPending, nil)
	pending := BuildMeetingDetail(captured, segments)
	if pending.TranscriptProvisional || len(pending.Segments) != 0 || pending.TranscriptText != "" {
		t.Fatalf("pending detail exposed incomplete transcript: %+v", pending)
	}
	provenance, internalError := `{"speakerCount":2,"coverage":0.75}`, "private engine failure"
	recording.DiarizationJSON, recording.DiarizationError = &provenance, &internalError
	diarization := BuildMeetingDetail(recording, nil).Diarization
	if diarization.SpeakerCount == nil || *diarization.SpeakerCount != 2 || diarization.Coverage == nil || *diarization.Coverage != .75 || diarization.Error == nil || *diarization.Error == internalError {
		t.Fatalf("unsafe or invalid diarization detail: %+v", diarization)
	}
}

func transcriptMeeting(capture db.CaptureStatus, processing db.ProcessingStatus, transcript *string) db.Meeting {
	return db.Meeting{ID: "m", Title: "Meeting", StartedAt: "2026-07-16T10:00:00Z",
		CaptureStatus: capture, CaptureStatusUpdatedAt: "2026-07-16T10:00:00Z",
		ProcessingStatus: processing, ProcessingStatusUpdatedAt: "2026-07-16T10:00:00Z",
		Transcript: transcript, Tags: "[]", Source: "listen"}
}
