package diarize

import (
	"math"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestStitchMatching(t *testing.T) {
	tests := []struct {
		name    string
		windows []WindowReport
		want    []int
	}{
		{"overlap before centroid", []WindowReport{window(0, 600, []LocalCluster{{"a", []float64{1, 0}}}, []LocalSpan{span("a", 0, 2, 1), span("a", 580, 590, 1)}), window(570, 40, []LocalCluster{{"b", []float64{0, 1}}}, []LocalSpan{span("b", 10, 20, 1)})}, []int{1, 1}},
		{"centroid and new", []WindowReport{window(0, 600, []LocalCluster{{"a", []float64{1, 0}}}, []LocalSpan{span("a", 0, 2, 1)}), window(570, 20, []LocalCluster{{"b", []float64{1, .1}}, {"c", []float64{0, 1}}}, []LocalSpan{span("b", 2, 4, 1), span("c", 5, 7, 1)})}, []int{1, 1, 2}},
		{"one to one", []WindowReport{window(0, 600, []LocalCluster{{"a", []float64{1, 0}}, {"b", []float64{0, 1}}}, []LocalSpan{span("b", 0, 2, 1), span("a", 570, 600, 1)}), window(570, 40, []LocalCluster{{"c", []float64{1, 0}}, {"d", []float64{0, 1}}}, []LocalSpan{span("c", 0, 20, 1), span("d", 20, 30, 1)})}, []int{2, 1, 2}},
		{"deterministic tie", []WindowReport{window(0, 600, []LocalCluster{{"a", []float64{1, 0}}}, []LocalSpan{span("a", 570, 590, 1)}), window(570, 30, []LocalCluster{{"d", []float64{0, 1}}, {"c", []float64{0, 1}}}, []LocalSpan{span("d", 0, 10, 1), span("c", 10, 20, 1)})}, []int{2, 1}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := stitch(test.windows)
			for i, want := range test.want {
				if len(got) != len(test.want) || got[i].speaker != want {
					t.Fatalf("spans = %+v, want speakers %v", got, test.want)
				}
			}
		})
	}
}

func TestOwnershipAndSpanConfidence(t *testing.T) {
	got := stitch([]WindowReport{window(0, 600, []LocalCluster{{"a", []float64{1}}}, []LocalSpan{span("a", 560, 590, 1)}), window(570, 40, []LocalCluster{{"b", []float64{1}}}, []LocalSpan{{"b", 0, 40, .8, .2}})})
	if len(got) != 2 || got[0].start != 560 || got[0].end != 570 || got[1].start != 570 || got[1].end != 610 || math.Abs(got[1].confidence-.2) > 1e-12 {
		t.Fatalf("stitched spans = %+v", got)
	}
}

func TestAlignmentRules(t *testing.T) {
	established := []stitchedSpan{sspan(1, 20, 23, 1), sspan(1, 24, 27, 1), sspan(2, 30, 33, 1), sspan(2, 34, 37, 1)}
	tests := []struct {
		name       string
		spans      []stitchedSpan
		phrase     Phrase
		reason     db.SpeakerAssignmentReason
		confidence float64
	}{
		{"established", []stitchedSpan{sspan(1, 0, 3, 1), sspan(1, 4, 7, 1)}, Phrase{"p", 0, 7}, db.SpeakerAssignmentReasonThresholdAssignment, 6.0 / 7},
		{"weak rival stays other", []stitchedSpan{sspan(1, 0, 3, 1), sspan(1, 4, 7, 1), sspan(2, 8, 10, 1)}, Phrase{"p", 8, 10}, db.SpeakerAssignmentReasonNoEvidence, -1},
		{"dominant fallback", []stitchedSpan{sspan(1, 0, 50, 1), sspan(1, 60, 110, 1), sspan(2, 120, 121, 1)}, Phrase{"p", 120, 121}, db.SpeakerAssignmentReasonDominantFallback, 1},
		{"single turn fallback", []stitchedSpan{sspan(1, 0, 2, .8), sspan(2, 3, 4, .7)}, Phrase{"p", 0, 2}, db.SpeakerAssignmentReasonSingleTurnFallback, .8},
		{"weighted ambiguous", add(established, sspan(1, 0, 9, .1), sspan(2, 9, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonAmbiguousSupport, -1},
		{"ninety inclusive", add(established, sspan(1, 0, 9, 1), sspan(2, 9, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .9},
		{"below ninety", add(established, sspan(1, 0, 8.9, 1), sspan(2, 8.9, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonAmbiguousSupport, -1},
		{"union fifty inclusive", add(established, sspan(1, 0, 3, 1), sspan(1, 2, 5, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .5},
		{"below fifty", add(established, sspan(1, 0, 4.9, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonInsufficientCoverage, -1},
		{"mean confidence", add(established, sspan(1, 0, 10, .7)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .7},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, _, _ := align([]Phrase{test.phrase}, test.spans)
			if got[0].Reason != test.reason || test.confidence < 0 && got[0].Confidence != nil || test.confidence >= 0 && (got[0].Confidence == nil || math.Abs(*got[0].Confidence-test.confidence) > 1e-12) {
				t.Fatalf("assignment = %+v", got[0])
			}
		})
	}
}

func TestNumberingCountAndCoverage(t *testing.T) {
	spans := []stitchedSpan{sspan(2, 0, 3, 1), sspan(2, 4, 7, 1), sspan(1, 10, 13, 1), sspan(1, 14, 17, 1), sspan(3, 20, 21, 1)}
	phrases := []Phrase{{"first", 0, 3}, {"second", 10, 13}, {"other", 20, 21}}
	assignments, count, coverage := align(phrases, spans)
	if assignments[0].Speaker != "Speaker 1" || assignments[1].Speaker != "Speaker 2" || assignments[2].Speaker != db.VisibleSpeakerOther || count != 2 || coverage != 6.0/7 {
		t.Fatalf("assignments=%+v count=%d coverage=%v", assignments, count, coverage)
	}
	out, err := Transform(Input{HasMicrophoneSpeech: true})
	if err != nil || out.SpeakerCount != 1 || len(out.Assignments) != 0 || out.Coverage != 0 {
		t.Fatalf("microphone output=%+v error=%v", out, err)
	}
}

func window(start, duration float64, clusters []LocalCluster, spans []LocalSpan) WindowReport {
	return WindowReport{start, duration, clusters, spans}
}
func span(cluster string, start, end, confidence float64) LocalSpan {
	return LocalSpan{cluster, start, end, confidence, 1}
}
func sspan(speaker int, start, end, confidence float64) stitchedSpan {
	return stitchedSpan{speaker, start, end, confidence}
}
func add(base []stitchedSpan, values ...stitchedSpan) []stitchedSpan {
	return append(append([]stitchedSpan(nil), base...), values...)
}
