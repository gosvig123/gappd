package livetranscript

import (
	"context"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
)

func TestReconcilesLongerPhraseAfterShortBoundarySegment(t *testing.T) {
	transcriber := fakeTranscriber{segments: map[string][]transcribe.Segment{
		"short.wav": {{Start: 2.44, End: 3.5, Text: "Confirmation."}},
		"long.wav":  {{Start: 0, End: 2.4, Text: "Confirmation number 742."}},
	}}
	rig := newTestRig(t, transcriber)
	outcome, err := runEvents(context.Background(), rig, boundaryEvents("short.wav", "long.wav"))
	assertSingleSegment(t, rig, outcome, err, "Confirmation number 742.")
}

func TestDropsShortBoundarySegmentAfterLongerPhrase(t *testing.T) {
	transcriber := fakeTranscriber{segments: map[string][]transcribe.Segment{
		"long.wav":  {{Start: 0.58, End: 3.5, Text: "Second system audio sample."}},
		"short.wav": {{Start: 0, End: 1.44, Text: "Audio sample."}},
	}}
	rig := newTestRig(t, transcriber)
	outcome, err := runEvents(context.Background(), rig, boundaryEvents("long.wav", "short.wav"))
	assertSingleSegment(t, rig, outcome, err, "Second system audio sample.")
}

func TestReconciliationDropsCapturedBoundarySuffix(t *testing.T) {
	existing := []db.Segment{testSegment(14.5, 18.5, "Other", "This sentence validates overlapping live transcript windows.")}
	incoming := []db.Segment{testSegment(17.5, 18.94, "Other", "Transcript windows.")}
	got := reconcileSegments(existing, incoming)
	if len(got) != 1 || got[0].Text != existing[0].Text {
		t.Fatalf("segments = %#v", got)
	}
}

func TestReconciliationKeepsDistinctOverlappingStatements(t *testing.T) {
	existing := []db.Segment{testSegment(0, 3, "You", "open the pod bay doors")}
	incoming := []db.Segment{testSegment(2, 4, "You", "close the pod bay doors")}
	if got := reconcileSegments(existing, incoming); len(got) != 2 {
		t.Fatalf("segments = %#v", got)
	}
}

func TestReconciliationKeepsDifferentSpeakers(t *testing.T) {
	existing := []db.Segment{testSegment(0, 3, "You", "Confirmation number 742")}
	incoming := []db.Segment{testSegment(1, 2, "Other", "Confirmation")}
	if got := reconcileSegments(existing, incoming); len(got) != 2 {
		t.Fatalf("segments = %#v", got)
	}
}

func TestReconciliationKeepsRepeatedNonOverlappingPhrase(t *testing.T) {
	existing := []db.Segment{testSegment(0, 1, "You", "confirmed")}
	incoming := []db.Segment{testSegment(2, 3, "You", "confirmed")}
	if got := reconcileSegments(existing, incoming); len(got) != 2 {
		t.Fatalf("segments = %#v", got)
	}
}

func TestReconciliationStillDropsExactOverlap(t *testing.T) {
	existing := []db.Segment{testSegment(0, 2, "You", "Hello world")}
	incoming := []db.Segment{testSegment(1, 3, "You", "hello world")}
	if got := reconcileSegments(existing, incoming); len(got) != 1 {
		t.Fatalf("segments = %#v", got)
	}
}

func boundaryEvents(first, second string) []Event {
	return []Event{
		{Kind: EventChunk, Source: SourceMic, Path: first, End: 3.5, CanonicalEnd: 3},
		{Kind: EventChunk, Source: SourceMic, Path: second, Start: 2.5, End: 6.5, CanonicalStart: 3, CanonicalEnd: 6},
		{Kind: EventSourceComplete, Source: SourceMic, Count: 2, CanonicalEnd: 6},
		{Kind: EventStreamComplete, Sources: []Source{SourceMic}},
	}
}

func testSegment(start, end float64, speaker, text string) db.Segment {
	return db.Segment{MeetingID: "meeting-live", Start: start, End: end, Speaker: speaker, Text: text}
}

func assertSingleSegment(t *testing.T, rig testRig, outcome Outcome, err error, text string) {
	t.Helper()
	if err != nil || outcome != OutcomeComplete {
		t.Fatalf("Finish() = %q, %v", outcome, err)
	}
	segments, loadErr := rig.store.GetSegments(rig.meetingID)
	if loadErr != nil || len(segments) != 1 || segments[0].Text != text {
		t.Fatalf("segments = %#v, error = %v", segments, loadErr)
	}
}
