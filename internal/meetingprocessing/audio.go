package meetingprocessing

import (
	"fmt"
	"sort"
	"strings"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

const (
	blankAudioMarker            = "blank_audio"
	silenceMarker               = "silence"
	markerWrapperCutset         = "[]()"
	normalizedTextSeparator     = " "
	segmentStartTieSeconds      = 1.0
	repeatedArtifactMinRunes    = 16
	repeatedArtifactMinSegments = 20
	repeatedArtifactDominance   = 0.8
)

func toDBSegments(meetingID string, segs []transcribe.Segment) []db.Segment {
	out := make([]db.Segment, len(segs))
	for i, s := range segs {
		out[i] = db.Segment{MeetingID: meetingID, Start: s.Start, End: s.End, Text: s.Text, Speaker: s.Speaker}
	}
	return out
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

func FormatTranscript(segments []db.Segment) string {
	var b strings.Builder
	for _, s := range segments {
		fmt.Fprintf(&b, "[%s] %s\n", s.Speaker, s.Text)
	}
	return b.String()
}

func sortSegmentsChronologically(segments []db.Segment) {
	indexed := indexedSegments(segments)
	sort.Slice(indexed, func(i, j int) bool { return segmentLess(indexed[i], indexed[j]) })
	for i, segment := range indexed {
		segments[i] = segment.segment
	}
}

type indexedSegment struct {
	segment db.Segment
	index   int
}

func indexedSegments(segments []db.Segment) []indexedSegment {
	indexed := make([]indexedSegment, len(segments))
	for i, segment := range segments {
		indexed[i] = indexedSegment{segment: segment, index: i}
	}
	return indexed
}

func segmentLess(a, b indexedSegment) bool {
	if speakerTieBreaks(a.segment, b.segment) {
		return speakerRank(a.segment.Speaker) < speakerRank(b.segment.Speaker)
	}
	return segmentNaturalLess(a, b)
}

func speakerTieBreaks(a, b db.Segment) bool {
	return nearStart(a.Start, b.Start) && speakerRank(a.Speaker) != speakerRank(b.Speaker)
}

func segmentNaturalLess(a, b indexedSegment) bool {
	switch {
	case a.segment.Start != b.segment.Start:
		return a.segment.Start < b.segment.Start
	case a.segment.End != b.segment.End:
		return a.segment.End < b.segment.End
	case a.segment.Speaker != b.segment.Speaker:
		return a.segment.Speaker < b.segment.Speaker
	case a.segment.Text != b.segment.Text:
		return a.segment.Text < b.segment.Text
	default:
		return a.index < b.index
	}
}

func nearStart(left, right float64) bool {
	delta := left - right
	if delta < 0 {
		delta = -delta
	}
	return delta <= segmentStartTieSeconds
}

func speakerRank(speaker string) int {
	if speaker == audioartifact.SystemSpeaker {
		return 0
	}
	if speaker == audioartifact.MicSpeaker {
		return 1
	}
	return 2
}
