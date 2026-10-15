package diarize

import (
	"math"
	"sort"
)

func stitchWindows(windows []WindowReport) ([]stitchedSpan, map[int][]float64) {
	globals := make(map[int]*globalCluster)
	next := 1
	var previous, out []stitchedSpan
	for wi, window := range windows {
		clusters := append([]LocalCluster(nil), window.Clusters...)
		sort.Slice(clusters, func(i, j int) bool { return clusters[i].ID < clusters[j].ID })
		matches := matchWindow(window, clusters, globals, previous)
		next = mergeWindowClusters(clusters, matches, globals, next)
		markUncleanClusters(window, matches, globals)
		canonicalEnd := window.StartSeconds + window.DurationSeconds
		if wi+1 < len(windows) {
			canonicalEnd = window.StartSeconds + WindowSeconds - WindowOverlapSeconds
		}
		spans, continuity := projectWindowSpans(window, matches, canonicalEnd)
		out, previous = append(out, spans...), continuity
	}
	return out, clusterVectors(globals)
}

func mergeWindowClusters(clusters []LocalCluster, matches map[string]clusterMatch, globals map[int]*globalCluster, next int) int {
	for _, cluster := range clusters {
		match, found := matches[cluster.ID]
		if !found {
			matches[cluster.ID] = clusterMatch{next, 1}
			globals[next] = &globalCluster{centroid: append([]float64(nil), cluster.Centroid...), count: 1, evidence: [][]float64{cluster.Centroid}}
			next++
			continue
		}
		global := globals[match.speaker]
		checkVoiceConsistency(global, cluster.Centroid)
		for i, value := range cluster.Centroid {
			global.centroid[i] = (global.centroid[i]*float64(global.count) + value) / float64(global.count+1)
		}
		global.count++
	}
	return next
}

func projectWindowSpans(window WindowReport, matches map[string]clusterMatch, canonicalEnd float64) ([]stitchedSpan, []stitchedSpan) {
	var out, previous []stitchedSpan
	for _, span := range window.Spans {
		match := matches[span.ClusterID]
		start, end := span.StartSeconds+window.StartSeconds, span.EndSeconds+window.StartSeconds
		short := span.EndSeconds-span.StartSeconds < ShortSpanSeconds
		confidence := math.Min(span.Quality, math.Min(match.continuity, span.Identity))
		vetoOnly := short && confidence < ShortSpanConfidenceThreshold
		if !short {
			previous = append(previous, stitchedSpan{speaker: match.speaker, start: start, end: end})
		}
		start, end = math.Max(start, window.StartSeconds), math.Min(end, canonicalEnd)
		if end > start {
			out = append(out, stitchedSpan{speaker: match.speaker, start: start, end: end, confidence: confidence, vetoOnly: vetoOnly})
		}
	}
	return out, previous
}
