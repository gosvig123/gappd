package meetingprocessing

import (
	"sort"

	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

const segmentStartTieSeconds = 1.0

func toDBSegments(meetingID string, segs []transcribe.Segment, source db.SegmentSource, reason db.SpeakerAssignmentReason) []db.Segment {
	out := make([]db.Segment, len(segs))
	for i, s := range segs {
		var groupStart, groupEnd *float64
		if s.GroupEnd > s.GroupStart {
			start, end := s.GroupStart, s.GroupEnd
			groupStart, groupEnd = &start, &end
		}
		out[i] = db.Segment{MeetingID: meetingID, Start: s.Start, End: s.End, Text: s.Text, Speaker: s.Speaker,
			SpeakerSource: &source, SpeakerAssignmentReason: &reason, SpeakerGroupStart: groupStart, SpeakerGroupEnd: groupEnd}
	}
	return out
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
