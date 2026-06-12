package recording

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Size() > 44
}

func hasCapturedAudio(recorder audioRecorder) bool {
	return fileExists(recorder.MicPath()) || fileExists(recorder.SystemPath())
}

func toDBSegments(meetingID string, segs []transcribe.Segment) []db.Segment {
	out := make([]db.Segment, len(segs))
	for i, s := range segs {
		out[i] = db.Segment{MeetingID: meetingID, Start: s.Start, End: s.End, Text: s.Text, Speaker: s.Speaker}
	}
	return out
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
	sort.Slice(indexed, func(i, j int) bool {
		return segmentLess(indexed[i], indexed[j])
	})
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
