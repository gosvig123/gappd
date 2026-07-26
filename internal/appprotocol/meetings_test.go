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
	internalError := "private engine failure"
	recording.DiarizationError = &internalError
	diarization := BuildMeetingDetail(recording, nil).Diarization
	if diarization.Error == nil || *diarization.Error == internalError {
		t.Fatalf("unsafe diarization detail: %+v", diarization)
	}
}

func TestDiarizationInfoSafelyDecodesCompletedSpeakerCount(t *testing.T) {
	tests := []struct {
		name       string
		state      db.DiarizationState
		provenance *string
		want       *int
	}{
		{name: "completed", state: db.DiarizationStateCompleted, provenance: stringPointer(`{"speakerCount":3}`), want: intPointer(3)},
		{name: "zero", state: db.DiarizationStateCompleted, provenance: stringPointer(`{"speakerCount":0}`), want: intPointer(0)},
		{name: "negative", state: db.DiarizationStateCompleted, provenance: stringPointer(`{"speakerCount":-1}`)},
		{name: "malformed", state: db.DiarizationStateCompleted, provenance: stringPointer(`{"speakerCount":"many"}`)},
		{name: "not completed", state: db.DiarizationStateProcessing, provenance: stringPointer(`{"speakerCount":3}`)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			meeting := transcriptMeeting(db.CaptureStatusCaptured, db.ProcessingStatusCompleted, nil)
			meeting.DiarizationState = test.state
			meeting.DiarizationJSON = test.provenance
			got := BuildMeetingDetail(meeting, nil).Diarization.SpeakerCount
			if (got == nil) != (test.want == nil) || got != nil && *got != *test.want {
				t.Fatalf("speakerCount = %v, want %v", got, test.want)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }
func intPointer(value int) *int          { return &value }

func transcriptMeeting(capture db.CaptureStatus, processing db.ProcessingStatus, transcript *string) db.Meeting {
	return db.Meeting{ID: "m", Title: "Meeting", StartedAt: "2026-07-16T10:00:00Z",
		CaptureStatus: capture, CaptureStatusUpdatedAt: "2026-07-16T10:00:00Z",
		ProcessingStatus: processing, ProcessingStatusUpdatedAt: "2026-07-16T10:00:00Z",
		Transcript: transcript, Tags: "[]", Source: "listen"}
}
