package diarize

import (
	"github.com/gappd-dev/gappd/internal/db"
	"math"
)

const minimumVoiceConsistency = 0.85

// The centroid uses all cluster speech. Reject the entire cluster if any of it is unclean.
func cleanClusterSpeech(speaker int, spans []stitchedSpan) (float64, float64) {
	seconds, quality := 0.0, 1.0
	for i, span := range spans {
		if span.speaker != speaker {
			continue
		}
		if span.vetoOnly || overlapsSpeech(i, spans) {
			return 0, 0
		}
		seconds += span.end - span.start
		quality = math.Min(quality, span.confidence)
	}
	return seconds, quality
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

// Check full windows too: stitched spans omit duplicate overlap, while centroids use it.
func markUncleanClusters(window WindowReport, matches map[string]clusterMatch, globals map[int]*globalCluster) {
	seen := map[string]bool{}
	for i, span := range window.Spans {
		seen[span.ClusterID] = true
		unclean := span.Quality < db.MinimumVoiceQuality || span.Identity < db.MinimumVoiceQuality || matches[span.ClusterID].continuity < db.MinimumVoiceQuality
		for j, other := range window.Spans {
			if i != j && math.Min(span.EndSeconds, other.EndSeconds) > math.Max(span.StartSeconds, other.StartSeconds) {
				unclean = true
			}
		}
		if unclean {
			globals[matches[span.ClusterID].speaker].unclean = true
		}
	}
	for _, cluster := range window.Clusters {
		if !seen[cluster.ID] {
			globals[matches[cluster.ID].speaker].unclean = true
		}
	}

}
