package meetingprocessing

import "github.com/gappd-dev/gappd/internal/db"

func removeAdjacentOverlapDuplicates(existing, incoming []db.Segment) []db.Segment {
	lastBySpeaker := latestSegmentsBySpeaker(existing)
	kept := make([]db.Segment, 0, len(incoming))
	for _, segment := range incoming {
		previous, found := lastBySpeaker[segment.Speaker]
		if !found || !exactOverlappingDuplicate(previous, segment) {
			kept = append(kept, segment)
			lastBySpeaker[segment.Speaker] = segment
		}
	}
	return kept
}

func latestSegmentsBySpeaker(segments []db.Segment) map[string]db.Segment {
	latest := make(map[string]db.Segment)
	for _, segment := range segments {
		previous, found := latest[segment.Speaker]
		if !found || segment.Start > previous.Start {
			latest[segment.Speaker] = segment
		}
	}
	return latest
}

func exactOverlappingDuplicate(left, right db.Segment) bool {
	return left.Start < right.End && right.Start < left.End &&
		normalizedSegmentText(left.Text) == normalizedSegmentText(right.Text)
}
