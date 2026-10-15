package diarize

import (
	"github.com/gappd-dev/gappd/internal/db"
	"testing"
)

func TestContradictoryWindowsCannotEnroll(t *testing.T) {
	left, right := make([]float64, 256), make([]float64, 256)
	left[0], right[1] = 1, 1
	windows := []WindowReport{
		window(0, 600, []LocalCluster{{"a", left}}, []LocalSpan{span("a", 550, 600, 1)}),
		window(570, 60, []LocalCluster{{"b", right}}, []LocalSpan{span("b", 0, 50, 1)}),
	}
	spans, vectors := stitchWindows(windows)
	if len(spans) == 0 {
		t.Fatal("transcript stitching changed")
	}
	if len(vectors) != 0 {
		t.Fatal("contradictory centroids became voice evidence")
	}
}

func TestVoiceEmbeddingsExcludeVanishedCompactedClusters(t *testing.T) {
	visible := map[int]db.VisibleSpeaker{1: "Speaker 1", 2: "Speaker 2"}
	labels := map[db.VisibleSpeaker]db.VisibleSpeaker{"Speaker 2": "Speaker 1"}
	vectors := map[int][]float64{1: {1, 0}, 2: {0, 1}}
	got := labeledEmbeddings(visible, labels, vectors, nil)
	if len(got) != 1 || got[0].Key != "Speaker 1" || got[0].Vector[1] != 1 {
		t.Fatalf("compaction retained vanished cluster: %+v", got)
	}
}

func TestVoiceQualityRejectsOverlapAndUncleanSpeech(t *testing.T) {
	spans := []stitchedSpan{{speaker: 1, start: 0, end: 20, confidence: .9}}
	seconds, quality := cleanClusterSpeech(1, spans)
	if seconds != 20 || quality != .9 {
		t.Fatal("clean evidence lost")
	}
	spans = append(spans, stitchedSpan{speaker: 2, start: 10, end: 15, confidence: 1})
	if seconds, _ := cleanClusterSpeech(1, spans); seconds != 0 {
		t.Fatal("overlapping speech accepted")
	}
	spans = spans[:1]
	spans[0].vetoOnly = true
	if seconds, _ := cleanClusterSpeech(1, spans); seconds != 0 {
		t.Fatal("suppressed speech accepted")
	}
}

func TestFullWindowQualityRejectsDiscardedOverlapEvidence(t *testing.T) {
	globals := map[int]*globalCluster{1: {centroid: []float64{1, 0}}}
	matches := map[string]clusterMatch{"remote": {speaker: 1, continuity: 1}}
	window := WindowReport{Clusters: []LocalCluster{{ID: "remote"}}, Spans: []LocalSpan{{ClusterID: "remote", StartSeconds: 590, EndSeconds: 600, Quality: .5, Identity: 1}}}
	markUncleanClusters(window, matches, globals)
	if len(clusterVectors(globals)) != 0 {
		t.Fatal("discarded overlap contaminated enrolled centroid")
	}
}
