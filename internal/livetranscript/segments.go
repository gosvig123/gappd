package livetranscript

import (
	"context"
	"fmt"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func (m Module) transcribeChunk(ctx context.Context, input StartInput, event Event) ([]db.Segment, error) {
	if m.transcriber == nil || m.store == nil {
		return nil, fmt.Errorf("Live Transcript requires transcriber and store")
	}
	segments, err := m.transcriber.Transcribe(ctx, event.Path, meetinglang.Normalize(input.Language))
	if err != nil {
		return nil, err
	}
	withSpeaker(segments, speakerFor(event.Source))
	cleaned := transcribe.CleanArtifacts(segments)
	return canonicalSegments(input.MeetingID, event, cleaned), nil
}

func speakerFor(source Source) string {
	if source == SourceMic {
		return audioartifact.MicSpeaker
	}
	if source == SourceSystem {
		return audioartifact.SystemSpeaker
	}
	return ""
}

func withSpeaker(segments []transcribe.Segment, speaker string) {
	for i := range segments {
		segments[i].Speaker = speaker
	}
}

func canonicalSegments(meetingID string, event Event, values []transcribe.Segment) []db.Segment {
	source, reason := db.SegmentSourceSystem, db.SpeakerAssignmentReasonPendingSystemAttribution
	if event.Source == SourceMic {
		source, reason = db.SegmentSourceMicrophone, db.SpeakerAssignmentReasonMicrophone
	}
	segments := make([]db.Segment, 0, len(values))
	for _, value := range values {
		start, end := value.Start+event.Start, value.End+event.Start
		midpoint := start + (end-start)/2
		if midpoint >= event.CanonicalStart && midpoint < event.CanonicalEnd {
			segments = append(segments, db.Segment{MeetingID: meetingID, Start: start, End: end, Text: value.Text, Speaker: value.Speaker,
				SpeakerSource: &source, SpeakerAssignmentReason: &reason})
		}
	}
	return segments
}

func (m Module) insertSegments(incoming []db.Segment) (int, error) {
	if len(incoming) == 0 {
		return 0, nil
	}
	existing, err := m.store.GetSegments(incoming[0].MeetingID)
	if err != nil {
		return 0, fmt.Errorf("read provisional segments: %w", err)
	}
	reconciled := reconcileSegments(existing, incoming)
	if err := m.store.ReplaceSegments(incoming[0].MeetingID, reconciled); err != nil {
		return 0, fmt.Errorf("replace provisional segments: %w", err)
	}
	return len(reconciled), nil
}
