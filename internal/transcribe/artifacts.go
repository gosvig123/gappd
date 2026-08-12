package transcribe

import "strings"

const (
	blankAudioMarker            = "blank_audio"
	silenceMarker               = "silence"
	markerWrapperCutset         = "[]()"
	repeatedArtifactMinRunes    = 16
	repeatedArtifactMinSegments = 20
	repeatedArtifactDominance   = 0.8
)

func CleanArtifacts(segments []Segment) []Segment {
	cleaned := make([]Segment, 0, len(segments))
	for _, segment := range segments {
		if !isArtifact(segment.Text) {
			cleaned = append(cleaned, segment)
		}
	}
	if hasDominantRepeatedText(cleaned) {
		return nil
	}
	return cleaned
}

func isArtifact(text string) bool {
	marker := strings.Trim(strings.ToLower(normalizedText(text)), markerWrapperCutset)
	return marker == "" || marker == blankAudioMarker || marker == silenceMarker
}

func hasDominantRepeatedText(segments []Segment) bool {
	if len(segments) < repeatedArtifactMinSegments {
		return false
	}
	counts := map[string]int{}
	maxCount := 0
	for _, segment := range segments {
		text := strings.ToLower(normalizedText(segment.Text))
		if len([]rune(text)) < repeatedArtifactMinRunes {
			continue
		}
		counts[text]++
		if counts[text] > maxCount {
			maxCount = counts[text]
		}
	}
	return maxCount >= repeatedArtifactMinSegments && float64(maxCount)/float64(len(segments)) >= repeatedArtifactDominance
}
