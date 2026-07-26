package livetranscript

import (
	"sort"
	"strings"
	"unicode"

	"github.com/gappd-dev/gappd/internal/db"
)

const maxShortDurationRatio = 0.8

func reconcileSegments(existing, incoming []db.Segment) []db.Segment {
	reconciled := append([]db.Segment(nil), existing...)
	for _, segment := range incoming {
		reconciled = reconcileSegment(reconciled, segment)
	}
	sort.SliceStable(reconciled, func(i, j int) bool {
		return reconciled[i].Start < reconciled[j].Start
	})
	return reconciled
}

func reconcileSegment(segments []db.Segment, incoming db.Segment) []db.Segment {
	kept := make([]db.Segment, 0, len(segments)+1)
	preferred := incoming
	for _, existing := range segments {
		if boundaryDuplicate(existing, preferred) {
			preferred = preferredSegment(existing, preferred)
			continue
		}
		kept = append(kept, existing)
	}
	return append(kept, preferred)
}

func boundaryDuplicate(left, right db.Segment) bool {
	if left.Speaker != right.Speaker || !segmentsOverlap(left, right) {
		return false
	}
	leftWords := normalizedWords(left.Text)
	rightWords := normalizedWords(right.Text)
	if equalWords(leftWords, rightWords) {
		return true
	}
	short, long, shortWords, longWords := orderedByWordCount(left, right, leftWords, rightWords)
	return len(shortWords) < len(longWords) && contiguousPhrase(longWords, shortWords) &&
		shortDurationEnough(short, long)
}

func orderedByWordCount(left, right db.Segment, leftWords, rightWords []string) (db.Segment, db.Segment, []string, []string) {
	if len(leftWords) <= len(rightWords) {
		return left, right, leftWords, rightWords
	}
	return right, left, rightWords, leftWords
}

func preferredSegment(left, right db.Segment) db.Segment {
	if len(normalizedWords(right.Text)) > len(normalizedWords(left.Text)) {
		return right
	}
	return left
}

func segmentsOverlap(left, right db.Segment) bool {
	return left.Start < right.End && right.Start < left.End
}

func shortDurationEnough(short, long db.Segment) bool {
	shortDuration := short.End - short.Start
	longDuration := long.End - long.Start
	return shortDuration > 0 && longDuration > 0 && shortDuration <= longDuration*maxShortDurationRatio
}

func normalizedWords(text string) []string {
	return strings.FieldsFunc(strings.ToLower(text), func(value rune) bool {
		return !unicode.IsLetter(value) && !unicode.IsNumber(value)
	})
}

func equalWords(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func contiguousPhrase(long, short []string) bool {
	if len(short) == 0 || len(short) > len(long) {
		return false
	}
	for start := 0; start <= len(long)-len(short); start++ {
		if equalWords(long[start:start+len(short)], short) {
			return true
		}
	}
	return false
}
