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

func TestStrongCentroidBeatsWeakOverlap(t *testing.T) {
	got := stitch([]WindowReport{
		window(0, 600, []LocalCluster{{"a", []float64{1, 0}}}, []LocalSpan{span("a", 580, 590, 1)}),
		window(570, 40, []LocalCluster{{"b", []float64{.6, .8}}, {"c", []float64{.9, math.Sqrt(.19)}}}, []LocalSpan{span("b", 10, 15, 1), span("c", 20, 24, 1), span("c", 26, 30, 1)}),
	})
	if len(got) != 3 || got[0].speaker != 2 || got[1].speaker != 1 || got[2].speaker != 1 {
		t.Fatalf("stitched spans = %+v", got)
	}
}

func TestCentroidOverrideRequiresGroundedBestClaim(t *testing.T) {
	globals := map[int]*globalCluster{1: {centroid: []float64{1, 0}}, 2: {centroid: []float64{.7, math.Sqrt(.51)}}}
	edge := candidate{local: "weak", speaker: 1, centroid: []float64{.6, .8}}
	clusters := []LocalCluster{{"weak", edge.centroid}, {"claim", []float64{.7, math.Sqrt(.51)}}}
	grounded := window(570, 40, clusters, []LocalSpan{span("weak", 10, 15, 1), span("claim", 20, 24, 1), span("claim", 26, 30, 1)})
	if claims := centroidOverrideClaims([]candidate{edge}, grounded, clusters, globals); len(claims) != 0 {
		t.Fatalf("claimant preferred another global: %+v", claims)
	}
	ungrounded := window(570, 40, clusters, []LocalSpan{span("weak", 10, 15, 1), span("claim", 20, 20.9, 1)})
	if claims := centroidOverrideClaims([]candidate{edge}, ungrounded, clusters, globals); len(claims) != 0 {
		t.Fatalf("ungrounded claimant reserved overlap: %+v", claims)
	}

	nearGlobals := map[int]*globalCluster{1: {centroid: []float64{.81, math.Sqrt(1 - .81*.81)}}, 2: {centroid: []float64{.809, math.Sqrt(1 - .809*.809)}}}
	nearClusters := []LocalCluster{{"weak", []float64{0, 1}}, {"claim", []float64{1, 0}}}
	nearEdge := candidate{local: "weak", speaker: 1, centroid: nearClusters[0].Centroid}
	nearWindow := window(570, 40, nearClusters, []LocalSpan{span("weak", 10, 15, 1), span("claim", 20, 24, 1), span("claim", 26, 30, 1)})
	if claims := centroidOverrideClaims([]candidate{nearEdge}, nearWindow, nearClusters, nearGlobals); len(claims) != 0 {
		t.Fatalf("near-tied claimant reserved overlap: %+v", claims)
	}
}

func TestOwnershipAndSpanConfidence(t *testing.T) {
	got := stitch([]WindowReport{window(0, 600, []LocalCluster{{"a", []float64{1}}}, []LocalSpan{span("a", 560, 590, 1)}), window(570, 40, []LocalCluster{{"b", []float64{1}}}, []LocalSpan{{"b", 0, 40, .8, .2}})})
	if len(got) != 2 || got[0].start != 560 || got[0].end != 570 || got[1].start != 570 || got[1].end != 610 || math.Abs(got[1].confidence-.2) > 1e-12 {
		t.Fatalf("stitched spans = %+v", got)
	}
}

func TestShortSpanConfidenceFilter(t *testing.T) {
	got := stitch([]WindowReport{window(0, 600, []LocalCluster{{"a", []float64{1}}}, []LocalSpan{
		span("a", 0, .9, .249),
		span("a", 1, 1.9, .25),
		span("a", 2, 3, .1), // One-second spans existed before short-segment recall was enabled.
	})})
	if len(got) != 3 || !got[0].vetoOnly || got[1].vetoOnly || got[1].start != 1 || got[1].end != 1.9 || got[2].start != 2 || got[2].end != 3 {
		t.Fatalf("stitched spans = %+v", got)
	}
}

func TestShortSpanCannotDriveWindowMatching(t *testing.T) {
	got := stitch([]WindowReport{
		window(0, 600, []LocalCluster{{"a", []float64{1, 0}}}, []LocalSpan{span("a", 580, 580.9, .25)}),
		window(570, 40, []LocalCluster{{"b", []float64{0, 1}}}, []LocalSpan{span("b", 10, 12, 1)}),
	})
	if len(got) != 1 || got[0].speaker != 2 {
		t.Fatalf("stitched spans = %+v", got)
	}
}

func TestSingleSpeakerConsensus(t *testing.T) {
	matchingAnchors := []WindowReport{
		consensusWindow([]float64{1, 0}),
		consensusWindow([]float64{.2, .98}, []float64{.8, .6}),
		consensusWindow([]float64{.98, .1}),
		consensusWindow([]float64{.1, .99}, []float64{.7, .7}, []float64{.3, .95}),
		consensusWindow([]float64{.95, .2}),
	}
	var spans []stitchedSpan
	for i := range matchingAnchors {
		matchingAnchors[i].StartSeconds = float64(i) * (WindowSeconds - WindowOverlapSeconds)
		spans = append(spans, sspan(1, matchingAnchors[i].StartSeconds, matchingAnchors[i].StartSeconds+500, 1))
	}
	spans = append(spans, sspan(2, 2700, 2775, 1), sspan(3, 2780, 2805, 1))
	if got := singleSpeakerConsensus(matchingAnchors, spans); got != 1 {
		t.Fatalf("single speaker = %d, want 1", got)
	}

	stablePair := []WindowReport{
		consensusWindow([]float64{1, 0}, []float64{0, 1}),
		consensusWindow([]float64{.9, .1}, []float64{.1, .9}),
		consensusWindow([]float64{.8, .2}, []float64{.2, .8}),
	}
	if got := singleSpeakerConsensus(stablePair, spans); got != 0 {
		t.Fatalf("stable pair collapsed to speaker %d", got)
	}

	inconsistentAnchors := []WindowReport{
		consensusWindow([]float64{1, 0}),
		consensusWindow([]float64{0, 1}),
		consensusWindow([]float64{1, 0}),
	}
	if got := singleSpeakerConsensus(inconsistentAnchors, spans); got != 0 {
		t.Fatalf("inconsistent anchors collapsed to speaker %d", got)
	}

	foreignAnchors := []WindowReport{
		consensusWindow([]float64{1, 0}),
		consensusWindow([]float64{.98, .1}),
		consensusWindow([]float64{.95, .2}),
	}
	var foreignSpans []stitchedSpan
	for i := range foreignAnchors {
		start := float64(i) * (WindowSeconds - WindowOverlapSeconds)
		foreignAnchors[i].StartSeconds = start
		foreignSpans = append(foreignSpans, sspan(1, start+10, start+200, 1), sspan(2, start, start+3, 1), sspan(2, start+4, start+7, 1))
	}
	if got := singleSpeakerConsensus(foreignAnchors, foreignSpans); got != 0 {
		t.Fatalf("foreign dominant speaker collapsed anchors to speaker %d", got)
	}

	var overlapOnly []WindowReport
	var overlapSpans []stitchedSpan
	for i := 0; i < 3; i++ {
		start := float64(i) * (WindowSeconds - WindowOverlapSeconds)
		overlapOnly = append(overlapOnly, window(start, WindowSeconds, []LocalCluster{{"a", []float64{1, 0}}}, []LocalSpan{span("a", 580, 583, 1), span("a", 584, 587, 1)}))
		overlapSpans = append(overlapSpans, sspan(1, start, start+590, 1))
	}
	if got := singleSpeakerConsensus(overlapOnly, overlapSpans); got != 0 {
		t.Fatalf("overlap-only anchors collapsed to speaker %d", got)
	}
}

func TestTransformSuppressesFragmentedMinoritySpeakers(t *testing.T) {
	dominant := []float64{1, 0}
	minority := []float64{0, 1}
	third := []float64{-.7, math.Sqrt(.51)}
	windows := []WindowReport{
		window(0, 600, []LocalCluster{{"a", dominant}}, []LocalSpan{span("a", 0, 280, 1), span("a", 281, 590, 1)}),
		window(570, 600, []LocalCluster{{"b", dominant}, {"c", minority}}, []LocalSpan{
			span("b", 0, 100, 1), span("c", 100, 103, 1), span("c", 104, 107, 1), span("b", 107, 590, 1),
		}),
		window(1140, 600, []LocalCluster{{"d", dominant}}, []LocalSpan{span("d", 0, 280, 1), span("d", 281, 590, 1)}),
		window(1710, 600, []LocalCluster{{"e", dominant}, {"f", minority}, {"g", third}}, []LocalSpan{
			span("e", 0, 100, 1), span("f", 100, 103, 1), span("f", 104, 107, 1), span("e", 107, 200, 1),
			span("g", 200, 203, 1), span("g", 204, 207, 1), span("e", 207, 590, 1),
		}),
		window(2280, 500, []LocalCluster{{"h", dominant}}, []LocalSpan{span("h", 0, 250, 1), span("h", 251, 500, 1)}),
	}
	phrases := []Phrase{{"dominant", 0, 10}, {"mixed", 660, 680}, {"minority", 670, 677}}
	got, err := Transform(Input{Windows: windows, Phrases: phrases})
	if err != nil {
		t.Fatal(err)
	}
	if got.SpeakerCount != 1 || got.Assignments[0].Speaker != "Speaker 1" ||
		got.Assignments[1].Speaker != db.VisibleSpeakerOther || got.Assignments[2].Speaker != db.VisibleSpeakerOther {
		t.Fatalf("output = %+v", got)
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
		{"dominant fallback", []stitchedSpan{sspan(1, 0, 50, 1), sspan(1, 60, 110, 1), sspan(2, 120, 121, 1)}, Phrase{"p", 0, 50}, db.SpeakerAssignmentReasonDominantFallback, 1},
		{"dominant rival stays other", []stitchedSpan{sspan(1, 0, 50, 1), sspan(1, 60, 110, 1), sspan(2, 120, 121, 1)}, Phrase{"p", 120, 121}, db.SpeakerAssignmentReasonAmbiguousSupport, -1},
		{"single turn fallback", []stitchedSpan{sspan(1, 0, 2, .8), sspan(2, 3, 4, .7)}, Phrase{"p", 0, 2}, db.SpeakerAssignmentReasonSingleTurnFallback, .8},
		{"weighted ambiguous", add(established, sspan(1, 0, 9, .1), sspan(2, 9, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonAmbiguousSupport, -1},
		{"ninety inclusive", add(established, sspan(1, 0, 9, 1), sspan(2, 9, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .9},
		{"high coverage relaxed winner", add(established, sspan(1, 0, 8.5, 1), sspan(2, 8.5, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .85},
		{"high coverage low confidence", add(established, sspan(1, 0, 8.5, .3), sspan(2, 8.5, 10, .3)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .3},
		{"high coverage ambiguous", add(established, sspan(1, 0, 8.49, 1), sspan(2, 8.49, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonAmbiguousSupport, -1},
		{"high coverage weak winner", add(established, sspan(3, 0, 8.5, 1), sspan(2, 8.5, 10, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonAmbiguousSupport, -1},
		{"union fifty inclusive", add(established, sspan(1, 0, 3, 1), sspan(1, 2, 5, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .5},
		{"high coverage combined boundary", add(established, sspan(1, 0, 4.25, 1), sspan(2, 4.25, 5, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .5},
		{"guarded coverage", add(established, sspan(1, 0, 4, .35)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .35},
		{"guarded weighted confidence", add(established, sspan(1, 0, 2, .2), sspan(1, 2, 4, .5)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .35},
		{"guarded winner inclusive", add(established, sspan(1, 0, 3.92, 1), sspan(2, 3.92, 4, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonThresholdAssignment, .4},
		{"guarded low confidence", add(established, sspan(1, 0, 4, .349)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonInsufficientCoverage, -1},
		{"guarded mixed support", add(established, sspan(1, 0, 3.9, 1), sspan(2, 3.9, 4, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonInsufficientCoverage, -1},
		{"guarded weak winner", add(established, sspan(3, 0, 4, .35)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonInsufficientCoverage, -1},
		{"below guarded coverage", add(established, sspan(1, 0, 3.99, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonInsufficientCoverage, -1},
		{"below fifty", add(established, sspan(1, 0, 3, 1)), Phrase{"p", 0, 10}, db.SpeakerAssignmentReasonInsufficientCoverage, -1},
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

func TestSuppressedSpeakerVetoesPhraseAssignment(t *testing.T) {
	spans := []stitchedSpan{
		sspan(1, 0, 4, 1),
		sspan(2, 4, 10, 1),
		sspan(1, 20, 23, 1),
		sspan(1, 24, 27, 1),
	}
	phrases := []Phrase{{"mixed", 0, 10}, {"minority", 4, 10}, {"dominant", 20, 27}}
	got, count, _ := alignWithSuppressed(phrases, spans, map[int]bool{2: true})
	if got[0].Speaker != db.VisibleSpeakerOther || got[0].Reason != db.SpeakerAssignmentReasonAmbiguousSupport ||
		got[1].Speaker != db.VisibleSpeakerOther || got[1].Reason != db.SpeakerAssignmentReasonAmbiguousSupport ||
		got[2].Speaker != "Speaker 1" || count != 1 {
		t.Fatalf("assignments = %+v, count = %d", got, count)
	}

	highMixed := []stitchedSpan{sspan(1, 0, 8.5, 1), sspan(2, 8.5, 10, .5), sspan(1, 20, 23, 1), sspan(1, 24, 27, 1)}
	got, count, _ = alignWithSuppressed([]Phrase{{"mixed", 0, 10}}, highMixed, map[int]bool{2: true})
	if got[0].Speaker != db.VisibleSpeakerOther || got[0].Reason != db.SpeakerAssignmentReasonAmbiguousSupport || count != 0 {
		t.Fatalf("high mixed assignment = %+v, count = %d", got[0], count)
	}

	lowConfidenceMixed := []stitchedSpan{sspan(1, 0, 8.9, 1), sspan(2, 8.9, 10, .05), sspan(1, 20, 23, 1), sspan(1, 24, 27, 1)}
	got, count, _ = alignWithSuppressed([]Phrase{{"mixed", 0, 10}}, lowConfidenceMixed, map[int]bool{2: true})
	if got[0].Speaker != db.VisibleSpeakerOther || got[0].Reason != db.SpeakerAssignmentReasonAmbiguousSupport || count != 0 {
		t.Fatalf("low-confidence mixed assignment = %+v, count = %d", got[0], count)
	}

	got, count, _ = alignWithSuppressed([]Phrase{{"suppressed", 0, 2}}, []stitchedSpan{sspan(2, 0, 2, .8)}, map[int]bool{2: true})
	if got[0].Speaker != db.VisibleSpeakerOther || count != 0 {
		t.Fatalf("suppressed fallback assignment = %+v, count = %d", got[0], count)
	}

	vetoSpans := []stitchedSpan{sspan(1, 0, 4, 1), sspan(1, 20, 23, 1), sspan(1, 24, 27, 1), {speaker: 2, start: 4, end: 10, confidence: .2, vetoOnly: true}}
	got, count, _ = alignWithSuppressed([]Phrase{{"veto", 0, 10}}, vetoSpans, nil)
	if got[0].Speaker != db.VisibleSpeakerOther || got[0].Reason != db.SpeakerAssignmentReasonAmbiguousSupport || count != 0 {
		t.Fatalf("veto-only assignment = %+v, count = %d", got[0], count)
	}
}

func TestWeakRivalCountsTowardPhraseSupport(t *testing.T) {
	spans := []stitchedSpan{
		sspan(1, 0, 6, 1),
		sspan(2, 6, 10, 1),
		sspan(1, 20, 23, 1),
		sspan(1, 24, 27, 1),
	}

	got, _, _ := align([]Phrase{{"p", 0, 10}}, spans)
	if got[0].Speaker != db.VisibleSpeakerOther || got[0].Reason != db.SpeakerAssignmentReasonAmbiguousSupport || got[0].Confidence != nil {
		t.Fatalf("assignment = %+v", got[0])
	}
}

func TestOverlappingEvidenceUsesTemporalUnion(t *testing.T) {
	spans := []stitchedSpan{sspan(2, 4, 10, .1), sspan(1, 20, 23, 1), sspan(1, 24, 27, 1)}
	for range 14 {
		spans = append(spans, sspan(1, 0, 4, 1))
	}
	got, _, _ := align([]Phrase{{"p", 0, 10}}, spans)
	if got[0].Speaker != db.VisibleSpeakerOther || got[0].Reason != db.SpeakerAssignmentReasonAmbiguousSupport {
		t.Fatalf("assignment = %+v", got[0])
	}
}

func TestSingleTurnFallbackIgnoresUnselectedTurns(t *testing.T) {
	spans := []stitchedSpan{
		sspan(1, 0, 2, .8),
		sspan(1, 4, 6, .7),
		sspan(2, 8, 9, .6),
	}

	got, _, _ := align([]Phrase{{"p", 0, 6}}, spans)
	if got[0].Speaker != db.VisibleSpeakerOther || got[0].Reason != db.SpeakerAssignmentReasonInsufficientCoverage || got[0].Confidence != nil {
		t.Fatalf("assignment = %+v", got[0])
	}
}

func TestProjectionGroupsPreserveEstablishedAssignments(t *testing.T) {
	windows := []WindowReport{window(0, 20, []LocalCluster{{"a", []float64{1, 0}}}, []LocalSpan{
		span("a", 0, 3, 1), span("a", 3.1, 6, 1),
	})}
	phrases := []Phrase{{"first", 0, 6}, {"second", 6, 10}}
	baseline, err := Transform(Input{Windows: windows, Phrases: phrases})
	if err != nil {
		t.Fatal(err)
	}
	if baseline.Assignments[0].Speaker != "Speaker 1" || baseline.Assignments[1].Speaker != db.VisibleSpeakerOther {
		t.Fatalf("baseline=%+v", baseline.Assignments)
	}
	grouped, err := Transform(Input{Windows: windows, Phrases: phrases, ProjectionGroups: []ProjectionGroup{{
		Phrase: Phrase{"first", 0, 10}, SegmentIDs: []string{"first", "second"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if grouped.Assignments[0].Speaker != "Speaker 1" || grouped.Assignments[1].Speaker != "Speaker 1" || grouped.Coverage != 1 {
		t.Fatalf("grouped=%+v coverage=%f", grouped.Assignments, grouped.Coverage)
	}
	if _, err := Transform(Input{Windows: windows, Phrases: phrases, ProjectionGroups: []ProjectionGroup{{
		Phrase: Phrase{"first", 0, 10}, SegmentIDs: []string{"missing"},
	}}}); err == nil {
		t.Fatal("accepted projection group with unknown child")
	}
}

func TestProjectionGroupsShareSpeakerNumbering(t *testing.T) {
	windows := []WindowReport{window(0, 20, []LocalCluster{{"a", []float64{1, 0}}, {"b", []float64{0, 1}}}, []LocalSpan{
		span("a", 0, 3, 1), span("a", 4, 7, 1), span("b", 10, 13, 1), span("b", 14, 17, 1),
	})}
	phrases := []Phrase{{"a", 0, 7}, {"b1", 10, 13}, {"b2", 14, 17}}
	output, err := Transform(Input{Windows: windows, Phrases: phrases, ProjectionGroups: []ProjectionGroup{{
		Phrase: Phrase{"b1", 10, 17}, SegmentIDs: []string{"b1", "b2"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if output.Assignments[0].Speaker != "Speaker 1" || output.Assignments[1].Speaker != "Speaker 2" ||
		output.Assignments[2].Speaker != "Speaker 2" || output.SpeakerCount != 2 {
		t.Fatalf("output=%+v", output)
	}
}

func TestProjectionGroupsRemoveOverriddenSpeakerLabels(t *testing.T) {
	windows := []WindowReport{window(0, 40, []LocalCluster{{"a", []float64{1, 0}}, {"b", []float64{0, 1}}}, []LocalSpan{
		span("a", 0, 3, 1), span("a", 3.1, 6, 1), span("b", 6, 20, 1), span("b", 20.1, 40, 1),
	})}
	phrases := []Phrase{{"a", 0, 6}, {"b", 6, 40}}
	output, err := Transform(Input{Windows: windows, Phrases: phrases, ProjectionGroups: []ProjectionGroup{{
		Phrase: Phrase{"a", 0, 40}, SegmentIDs: []string{"a", "b"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if output.Assignments[0].Speaker != "Speaker 1" || output.Assignments[1].Speaker != "Speaker 1" || output.SpeakerCount != 1 {
		t.Fatalf("output=%+v", output)
	}
}

func TestProjectionGroupsRecoverOnlyConfidentChildren(t *testing.T) {
	windows := []WindowReport{window(0, 30, []LocalCluster{{"a", []float64{1, 0}}, {"b", []float64{0, 1}}}, []LocalSpan{
		span("a", 0, 4, 1), span("b", 4, 10, .1), span("a", 20, 23, 1), span("a", 24, 27, 1),
	})}
	phrases := []Phrase{{"first", 0, 4}, {"second", 4, 10}}
	output, err := Transform(Input{Windows: windows, Phrases: phrases, ProjectionGroups: []ProjectionGroup{{
		Phrase: Phrase{"first", 0, 10}, SegmentIDs: []string{"first", "second"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if output.Assignments[0].Speaker != "Speaker 1" || output.Assignments[1].Speaker != db.VisibleSpeakerOther ||
		output.SpeakerCount != 1 || math.Abs(output.Coverage-.4) > 1e-9 {
		t.Fatalf("output=%+v", output)
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
	return stitchedSpan{speaker: speaker, start: start, end: end, confidence: confidence}
}
func add(base []stitchedSpan, values ...stitchedSpan) []stitchedSpan {
	return append(append([]stitchedSpan(nil), base...), values...)
}

func consensusWindow(centroids ...[]float64) WindowReport {
	window := WindowReport{DurationSeconds: WindowSeconds}
	for i, centroid := range centroids {
		id := string(rune('a' + i))
		window.Clusters = append(window.Clusters, LocalCluster{id, centroid})
		window.Spans = append(window.Spans, span(id, float64(i*10), float64(i*10+3), 1), span(id, float64(i*10+4), float64(i*10+7), 1))
	}
	return window
}
