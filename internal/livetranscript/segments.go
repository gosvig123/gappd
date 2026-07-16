package livetranscript

import (
	"context"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

const (
	blankAudioMarker            = "blank_audio"
	silenceMarker               = "silence"
	markerWrapperCutset         = "[]()"
	normalizedTextSeparator     = " "
	repeatedArtifactMinRunes    = 16
	repeatedArtifactMinSegments = 20
	repeatedArtifactDominance   = 0.8
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
	cleaned := cleanTranscriptionArtifacts(segments)
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
	segments := make([]db.Segment, 0, len(values))
	for _, value := range values {
		start, end := value.Start+event.Start, value.End+event.Start
		midpoint := start + (end-start)/2
		if midpoint >= event.CanonicalStart && midpoint < event.CanonicalEnd {
			segments = append(segments, db.Segment{MeetingID: meetingID, Start: start, End: end, Text: value.Text, Speaker: value.Speaker})
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

func cleanTranscriptionArtifacts(segments []transcribe.Segment) []transcribe.Segment {
	cleaned := make([]transcribe.Segment, 0, len(segments))
	for _, segment := range segments {
		if !isTranscriptionArtifact(segment.Text) {
			cleaned = append(cleaned, segment)
		}
	}
	if hasDominantRepeatedText(cleaned) {
		return nil
	}
	return cleaned
}

func isTranscriptionArtifact(text string) bool {
	marker := strings.Trim(normalizedSegmentText(text), markerWrapperCutset)
	return marker == "" || marker == blankAudioMarker || marker == silenceMarker
}

func normalizedSegmentText(text string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(text)), normalizedTextSeparator))
}

func hasDominantRepeatedText(segments []transcribe.Segment) bool {
	if len(segments) < repeatedArtifactMinSegments {
		return false
	}
	return dominantRepeatedText(segments) >= repeatedArtifactMinSegments
}

func dominantRepeatedText(segments []transcribe.Segment) int {
	counts := map[string]int{}
	maxCount := 0
	for _, segment := range segments {
		maxCount = countRepeatedSegment(counts, maxCount, segment)
	}
	if float64(maxCount)/float64(len(segments)) < repeatedArtifactDominance {
		return 0
	}
	return maxCount
}

func countRepeatedSegment(counts map[string]int, maxCount int, segment transcribe.Segment) int {
	text := normalizedSegmentText(segment.Text)
	if len([]rune(text)) < repeatedArtifactMinRunes {
		return maxCount
	}
	counts[text]++
	if counts[text] > maxCount {
		return counts[text]
	}
	return maxCount
}

func formatTranscript(segments []db.Segment) string {
	var builder strings.Builder
	for _, segment := range segments {
		fmt.Fprintf(&builder, "[%s] %s\n", segment.Speaker, segment.Text)
	}
	return builder.String()
}
