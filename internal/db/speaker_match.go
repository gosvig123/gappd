package db

import (
	"math"
	"sort"
)

const (
	profileMatchSimilarity = 0.90
	profileMatchMargin     = 0.12
)

type voiceProfile struct {
	PersonID string
	Vector   []float64
}

type speakerMatch struct {
	Key      string
	PersonID string
}

type scoredMatch struct {
	key, person string
	score       float64
}

func matchProfiles(samples []SpeakerEmbedding, profiles []voiceProfile) []speakerMatch {
	ranked := make([]scoredMatch, 0, len(samples))
	for _, sample := range samples {
		person, score, margin := bestProfile(sample.Vector, profiles)
		if person != "" && score >= profileMatchSimilarity && margin >= profileMatchMargin && clusterMargin(sample, person, score, samples, profiles) >= profileMatchMargin {
			ranked = append(ranked, scoredMatch{sample.Key, person, score})
		}
	}
	sort.Slice(ranked, func(i, j int) bool {
		return ranked[i].score > ranked[j].score || ranked[i].score == ranked[j].score && ranked[i].key < ranked[j].key
	})
	return uniqueMatches(ranked)
}

func bestProfile(vector []float64, profiles []voiceProfile) (string, float64, float64) {
	bestID, best, second := "", -1.0, -1.0
	if _, err := normalizeVoice(vector); err != nil {
		return "", -1, 0
	}
	for _, profile := range profiles {
		if _, err := normalizeVoice(profile.Vector); err != nil {
			continue
		}
		score := cosine(vector, profile.Vector)
		if score > best {
			bestID, second, best = profile.PersonID, best, score
			continue
		}
		if score > second {
			second = score
		}
	}
	return bestID, best, best - second
}

func uniqueMatches(ranked []scoredMatch) []speakerMatch {
	usedSpeaker, usedPerson := make(map[string]bool), make(map[string]bool)
	out := make([]speakerMatch, 0)
	for _, item := range ranked {
		if usedSpeaker[item.key] || usedPerson[item.person] {
			continue
		}
		usedSpeaker[item.key], usedPerson[item.person] = true, true
		out = append(out, speakerMatch{item.key, item.person})
	}
	return out
}

func cosine(left, right []float64) float64 {
	dot, ll, rr := 0.0, 0.0, 0.0
	for i := range left {
		dot, ll, rr = dot+left[i]*right[i], ll+left[i]*left[i], rr+right[i]*right[i]
	}
	if ll == 0 || rr == 0 {
		return -1
	}
	return dot / math.Sqrt(ll*rr)
}

// Competing clusters must also be separated; never choose an arbitrary winner.
func clusterMargin(sample SpeakerEmbedding, person string, score float64, samples []SpeakerEmbedding, profiles []voiceProfile) float64 {
	second := -1.0
	for _, profile := range profiles {
		if profile.PersonID != person {
			continue
		}
		for _, other := range samples {
			if other.Key != sample.Key && len(other.Vector) == len(profile.Vector) {
				second = math.Max(second, cosine(other.Vector, profile.Vector))
			}
		}
	}
	return score - second
}
