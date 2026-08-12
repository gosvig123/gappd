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
