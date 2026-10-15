package diarize

import "math"

const minimumVoiceConsistency = 0.85

// Voice evidence counts only clean speech: high quality and continuity, no overlap, not suppressed.
// Per-span identity is not required: in calls with several speakers it is rarely high, and a
// manual label confirms who the cluster is. Returns clean seconds and their share of the speech.
func cleanClusterSpeech(speaker int, spans []stitchedSpan) (float64, float64) {
	total, clean := 0.0, 0.0
	for i, span := range spans {
		if span.speaker != speaker {
			continue
		}
		total += span.end - span.start
		if span.voiceClean && !span.vetoOnly && !overlapsSpeech(i, spans) {
			clean += span.end - span.start
		}
	}
	if total == 0 {
		return 0, 0
	}
	return clean, clean / total
}

func overlapsSpeech(index int, spans []stitchedSpan) bool {
	current := spans[index]
	for i, span := range spans {
		if i != index && math.Min(current.end, span.end) > math.Max(current.start, span.start) {
			return true
		}
	}
	return false
}

// Voice evidence requires agreement between every contributing window, not just temporal overlap.
func checkVoiceConsistency(cluster *globalCluster, vector []float64) {
	for _, previous := range cluster.evidence {
		if cosine(previous, vector) < minimumVoiceConsistency {
			cluster.unclean = true
		}
	}
	cluster.evidence = append(cluster.evidence, vector)
}

// A window centroid without any span cannot be checked against speech; reject its cluster.
func markVanishedClusters(window WindowReport, matches map[string]clusterMatch, globals map[int]*globalCluster) {
	seen := map[string]bool{}
	for _, span := range window.Spans {
		seen[span.ClusterID] = true
	}
	for _, cluster := range window.Clusters {
		if !seen[cluster.ID] {
			globals[matches[cluster.ID].speaker].unclean = true
		}
	}
}
