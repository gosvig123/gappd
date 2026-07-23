package meetingprocessing

import (
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func TestSortSegmentsOrdersNearTieQuestionBeforeAnswer(t *testing.T) {
	segments := []db.Segment{{Start: 10.4, End: 11, Speaker: "You", Text: "No."}, {Start: 10.8, End: 12, Speaker: "Other", Text: "Question?"}}

	sortSegmentsChronologically(segments)

	if segments[0].Speaker != "Other" || segments[1].Speaker != "You" {
		t.Fatalf("segments = %#v, want Other before You for near tie", segments)
	}
}

func TestToDBSegmentsPreservesSpeakerGroup(t *testing.T) {
	segments := toDBSegments("meeting", []transcribe.Segment{{
		Start: 2, End: 4, GroupStart: 1, GroupEnd: 8, Text: "words", Speaker: "Other",
	}}, db.SegmentSourceSystem, db.SpeakerAssignmentReasonPendingSystemAttribution)
	if len(segments) != 1 || segments[0].SpeakerGroupStart == nil || segments[0].SpeakerGroupEnd == nil ||
		*segments[0].SpeakerGroupStart != 1 || *segments[0].SpeakerGroupEnd != 8 {
		t.Fatalf("segments=%#v", segments)
	}
}

func TestCleanTranscriptionArtifactsDropsBlankAudio(t *testing.T) {
	segments := []transcribe.Segment{{Text: "[BLANK_AUDIO]"}, {Text: " useful words "}}

	got := cleanTranscriptionArtifacts(segments)

	if len(got) != 1 || got[0].Text != " useful words " {
		t.Fatalf("cleanTranscriptionArtifacts() = %#v, want useful segment only", got)
	}
}

func TestCleanTranscriptionArtifactsDropsDominantRepeatedSource(t *testing.T) {
	segments := repeatedSegments("And I'm going to let you know.", 25)
	segments = append(segments, transcribe.Segment{Text: "one rare segment"})

	got := cleanTranscriptionArtifacts(segments)

	if len(got) != 0 {
		t.Fatalf("cleanTranscriptionArtifacts() kept %d segments, want source dropped", len(got))
	}
}

func TestCleanTranscriptionArtifactsKeepsShortRepeatedWords(t *testing.T) {
	segments := repeatedSegments("yes", 25)

	got := cleanTranscriptionArtifacts(segments)

	if len(got) != len(segments) {
		t.Fatalf("cleanTranscriptionArtifacts() kept %d segments, want %d", len(got), len(segments))
	}
}

func repeatedSegments(text string, count int) []transcribe.Segment {
	segments := make([]transcribe.Segment, 0, count)
	for i := 0; i < count; i++ {
		segments = append(segments, transcribe.Segment{Text: text})
	}
	return segments
}
