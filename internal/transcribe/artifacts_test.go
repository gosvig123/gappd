package transcribe

import "testing"

func TestCleanArtifactsDropsBlankAudio(t *testing.T) {
	segments := []Segment{{Text: "[BLANK_AUDIO]"}, {Text: " useful words "}}

	got := CleanArtifacts(segments)

	if len(got) != 1 || got[0].Text != " useful words " {
		t.Fatalf("CleanArtifacts() = %#v, want useful segment only", got)
	}
}

func TestCleanArtifactsDropsDominantRepeatedSource(t *testing.T) {
	segments := repeatedSegments("And I'm going to let you know.", 25)
	segments = append(segments, Segment{Text: "one rare segment"})

	got := CleanArtifacts(segments)

	if len(got) != 0 {
		t.Fatalf("CleanArtifacts() kept %d segments, want source dropped", len(got))
	}
}

func TestCleanArtifactsKeepsShortRepeatedWords(t *testing.T) {
	segments := repeatedSegments("yes", 25)

	got := CleanArtifacts(segments)

	if len(got) != len(segments) {
		t.Fatalf("CleanArtifacts() kept %d segments, want %d", len(got), len(segments))
	}
}

func repeatedSegments(text string, count int) []Segment {
	segments := make([]Segment, 0, count)
	for i := 0; i < count; i++ {
		segments = append(segments, Segment{Text: text})
	}
	return segments
}
