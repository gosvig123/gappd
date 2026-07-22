// Package diarize stitches window-local speakers and projects them onto phrases.
package diarize

import (
	"fmt"
	"math"
	"slices"
	"sort"

	"github.com/gappd-dev/gappd/internal/db"
)

const (
	WindowSeconds                    = 600.0
	WindowOverlapSeconds             = 30.0
	CentroidSimilarityThreshold      = 0.65
	CentroidOverrideSimilarity       = 0.80
	CentroidOverrideMargin           = 0.10
	CentroidOverrideGlobalMargin     = 0.05
	VisibleSpanThreshold             = 0.10
	ShortSpanSeconds                 = 1.00
	ShortSpanConfidenceThreshold     = 0.25
	AmbiguousSupportThreshold        = 0.90
	PhraseCoverageThreshold          = 0.50
	HighCoverageWinnerShareThreshold = 0.85
	GuardedWinnerShareThreshold      = 0.98
	GuardedPhraseCoverageThreshold   = 0.40
	GuardedMeanConfidenceThreshold   = 0.35
	ActiveSpeakerSeconds             = 5.0
	ActiveSpeakerTurns               = 2
	DominantSpeakerShare             = 0.95
	SingleSpeakerWindowShare         = 0.60
	MinimumSingleSpeakerWindows      = 3
	SingleSpeakerAnchorSimilarity    = 0.80
	SingleSpeakerAnchorDominance     = 0.80
	ProjectionSemantics              = "v2"
)

type WindowReport struct {
	StartSeconds, DurationSeconds float64
	Clusters                      []LocalCluster
	Spans                         []LocalSpan
}
type LocalCluster struct {
	ID       string
	Centroid []float64
}
type LocalSpan struct {
	ClusterID                string
	StartSeconds, EndSeconds float64
	Quality, Identity        float64
}
type Phrase struct {
	SegmentID                string
	StartSeconds, EndSeconds float64
}
type Input struct {
	Windows             []WindowReport
	Phrases             []Phrase
	HasMicrophoneSpeech bool
}
type Output struct {
	Assignments  []db.SpeakerProjectionAssignment
	SpeakerCount int
	Coverage     float64
}

type globalCluster struct {
	centroid []float64
	count    int
}
type stitchedSpan struct {
	speaker                int
	start, end, confidence float64
	vetoOnly               bool
}
type clusterMatch struct {
	speaker    int
	continuity float64
}
type candidate struct {
	local    string
	speaker  int
	score    float64
	centroid []float64
}
type speakerAnchor struct {
	centroid  []float64
	intervals [][2]float64
}

func Transform(in Input) (Output, error) {
	if err := validate(in); err != nil {
		return Output{}, err
	}
	spans := stitch(in.Windows)
	suppressed := make(map[int]bool)
	if speaker := singleSpeakerConsensus(in.Windows, spans); speaker != 0 {
		for _, span := range spans {
			if !span.vetoOnly && span.speaker != speaker {
				suppressed[span.speaker] = true
			}
		}
	}
	assignments, count, coverage := alignWithSuppressed(in.Phrases, spans, suppressed)
	if in.HasMicrophoneSpeech {
		count++
	}
	return Output{assignments, count, coverage}, nil
}

func validate(in Input) error {
	dimension := 0
	for wi, window := range in.Windows {
		if !finite(window.StartSeconds, window.DurationSeconds) || window.DurationSeconds <= 0 || window.DurationSeconds > WindowSeconds ||
			window.StartSeconds != float64(wi)*(WindowSeconds-WindowOverlapSeconds) || wi+1 < len(in.Windows) && window.DurationSeconds != WindowSeconds {
			return fmt.Errorf("diarize: invalid window %d", wi)
		}
		clusters := make(map[string]bool, len(window.Clusters))
		for ci, cluster := range window.Clusters {
			if cluster.ID == "" || clusters[cluster.ID] || len(cluster.Centroid) == 0 {
				return fmt.Errorf("diarize: invalid cluster %d in window %d", ci, wi)
			}
			clusters[cluster.ID] = true
			if dimension == 0 {
				dimension = len(cluster.Centroid)
			}
			if len(cluster.Centroid) != dimension || !finite(cluster.Centroid...) {
				return fmt.Errorf("diarize: invalid centroid in window %d", wi)
			}
		}
		last := -1.0
		for si, span := range window.Spans {
			if !clusters[span.ClusterID] || !finite(span.StartSeconds, span.EndSeconds, span.Quality, span.Identity) ||
				span.StartSeconds < 0 || span.EndSeconds <= span.StartSeconds || span.EndSeconds > window.DurationSeconds || span.StartSeconds < last ||
				span.Quality < 0 || span.Quality > 1 || span.Identity < 0 || span.Identity > 1 {
				return fmt.Errorf("diarize: invalid span %d in window %d", si, wi)
			}
			last = span.StartSeconds
		}
	}
	ids, last := make(map[string]bool, len(in.Phrases)), -1.0
	for i, phrase := range in.Phrases {
		if phrase.SegmentID == "" || ids[phrase.SegmentID] || !finite(phrase.StartSeconds, phrase.EndSeconds) ||
			phrase.StartSeconds < 0 || phrase.EndSeconds <= phrase.StartSeconds || phrase.StartSeconds < last {
			return fmt.Errorf("diarize: invalid phrase %d", i)
		}
		ids[phrase.SegmentID], last = true, phrase.StartSeconds
	}
	return nil
}

func stitch(windows []WindowReport) []stitchedSpan {
	globals := make(map[int]*globalCluster)
	next := 1
	var previous []stitchedSpan
	var out []stitchedSpan
	for wi, window := range windows {
		clusters := append([]LocalCluster(nil), window.Clusters...)
		sort.Slice(clusters, func(i, j int) bool { return clusters[i].ID < clusters[j].ID })
		matches := matchWindow(window, clusters, globals, previous)
		for _, cluster := range clusters {
			match, found := matches[cluster.ID]
			if !found {
				match = clusterMatch{next, 1}
				matches[cluster.ID] = match
				globals[next] = &globalCluster{append([]float64(nil), cluster.Centroid...), 1}
				next++
			} else {
				global := globals[match.speaker]
				for i, value := range cluster.Centroid {
					global.centroid[i] = (global.centroid[i]*float64(global.count) + value) / float64(global.count+1)
				}
				global.count++
			}
		}
		canonicalEnd := window.StartSeconds + window.DurationSeconds
		if wi+1 < len(windows) {
			canonicalEnd = window.StartSeconds + WindowSeconds - WindowOverlapSeconds
		}
		previous = previous[:0]
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
	}
	return out
}

func matchWindow(window WindowReport, clusters []LocalCluster, globals map[int]*globalCluster, previous []stitchedSpan) map[string]clusterMatch {
	matches := make(map[string]clusterMatch)
	centroids := make(map[string][]float64, len(clusters))
	for _, cluster := range clusters {
		centroids[cluster.ID] = cluster.Centroid
	}
	used := make(map[int]bool)
	overlaps := make(map[string]map[int][][2]float64)
	for _, span := range window.Spans {
		if span.EndSeconds-span.StartSeconds < ShortSpanSeconds {
			continue
		}
		start, end := span.StartSeconds+window.StartSeconds, span.EndSeconds+window.StartSeconds
		for _, old := range previous {
			if overlap(start, end, old.start, old.end) <= 0 {
				continue
			}
			if overlaps[span.ClusterID] == nil {
				overlaps[span.ClusterID] = make(map[int][][2]float64)
			}
			overlaps[span.ClusterID][old.speaker] = append(overlaps[span.ClusterID][old.speaker], [2]float64{math.Max(start, old.start), math.Min(end, old.end)})
		}
	}
	var edges []candidate
	for local, speakers := range overlaps {
		for speaker, intervals := range speakers {
			edges = append(edges, candidate{local: local, speaker: speaker, score: unionSeconds(intervals), centroid: centroids[local]})
		}
	}
	overlapEdges := edges
	claims := centroidOverrideClaims(overlapEdges, window, clusters, globals)
	sort.Slice(claims, func(i, j int) bool { return candidateLess(claims[i], claims[j]) })
	for _, claim := range claims {
		if _, found := matches[claim.local]; !found && !used[claim.speaker] {
			matches[claim.local], used[claim.speaker] = clusterMatch{claim.speaker, centroidContinuity(claim, globals)}, true
		}
	}
	sort.Slice(overlapEdges, func(i, j int) bool { return candidateLess(overlapEdges[i], overlapEdges[j]) })
	for _, edge := range overlapEdges {
		if _, found := matches[edge.local]; !found && !used[edge.speaker] {
			matches[edge.local], used[edge.speaker] = clusterMatch{edge.speaker, math.Min(1, edge.score/2)}, true
		}
	}
	edges = nil
	for _, cluster := range clusters {
		if _, found := matches[cluster.ID]; found {
			continue
		}
		for speaker, global := range globals {
			score := cosine(cluster.Centroid, global.centroid)
			if !used[speaker] && score >= CentroidSimilarityThreshold {
				edges = append(edges, candidate{cluster.ID, speaker, score, cluster.Centroid})
			}
		}
	}
	sort.Slice(edges, func(i, j int) bool { return candidateLess(edges[i], edges[j]) })
	for _, edge := range edges {
		if _, found := matches[edge.local]; found || used[edge.speaker] {
			continue
		}
		matches[edge.local], used[edge.speaker] = clusterMatch{edge.speaker, centroidContinuity(edge, globals)}, true
	}
	return matches
}

func centroidOverrideClaims(overlaps []candidate, window WindowReport, clusters []LocalCluster, globals map[int]*globalCluster) []candidate {
	var claims []candidate
	for _, edge := range overlaps {
		current := cosine(edge.centroid, globals[edge.speaker].centroid)
		for _, cluster := range clusters {
			if cluster.ID == edge.local {
				continue
			}
			seconds, turns := localClusterMetric(window, cluster.ID)
			if seconds < ActiveSpeakerSeconds || turns < ActiveSpeakerTurns {
				continue
			}
			similarity, second := cosine(cluster.Centroid, globals[edge.speaker].centroid), -1.0
			for speaker, global := range globals {
				if speaker != edge.speaker {
					second = math.Max(second, cosine(cluster.Centroid, global.centroid))
				}
			}
			if similarity >= CentroidOverrideSimilarity && similarity-current >= CentroidOverrideMargin && similarity-second >= CentroidOverrideGlobalMargin {
				claims = append(claims, candidate{cluster.ID, edge.speaker, similarity, cluster.Centroid})
			}
		}
	}
	return claims
}

func centroidContinuity(edge candidate, globals map[int]*globalCluster) float64 {
	second := -1.0
	for speaker, global := range globals {
		if speaker != edge.speaker {
			second = math.Max(second, cosine(edge.centroid, global.centroid))
		}
	}
	similarity := clamp((edge.score - CentroidSimilarityThreshold) / (1 - CentroidSimilarityThreshold))
	return math.Min(similarity, .5+.5*clamp((edge.score-second)/.1))
}

func localClusterMetric(window WindowReport, clusterID string) (float64, int) {
	return intervalMetric(localClusterIntervals(window, clusterID))
}

func localClusterIntervals(window WindowReport, clusterID string) [][2]float64 {
	var intervals [][2]float64
	for _, span := range window.Spans {
		if span.ClusterID != clusterID {
			continue
		}
		confidence := math.Min(span.Quality, span.Identity)
		if confidence < VisibleSpanThreshold || span.EndSeconds-span.StartSeconds < ShortSpanSeconds && confidence < ShortSpanConfidenceThreshold {
			continue
		}
		intervals = append(intervals, [2]float64{span.StartSeconds, span.EndSeconds})
	}
	return intervals
}

func singleSpeakerConsensus(windows []WindowReport, spans []stitchedSpan) int {
	var anchors []speakerAnchor
	nonEmptyWindows := 0
	for wi, window := range windows {
		var active []speakerAnchor
		canonicalEnd := window.DurationSeconds
		if wi+1 < len(windows) {
			canonicalEnd = WindowSeconds - WindowOverlapSeconds
		}
		for _, cluster := range window.Clusters {
			var absolute [][2]float64
			for _, interval := range localClusterIntervals(window, cluster.ID) {
				start, end := math.Max(0, interval[0]), math.Min(canonicalEnd, interval[1])
				if end > start {
					absolute = append(absolute, [2]float64{start + window.StartSeconds, end + window.StartSeconds})
				}
			}
			seconds, turns := intervalMetric(append([][2]float64(nil), absolute...))
			if seconds >= ActiveSpeakerSeconds && turns >= ActiveSpeakerTurns {
				active = append(active, speakerAnchor{cluster.Centroid, absolute})
			}
		}
		if len(active) == 0 {
			continue
		}
		nonEmptyWindows++
		if len(active) == 1 {
			anchors = append(anchors, active[0])
		}
	}
	if len(anchors) < MinimumSingleSpeakerWindows || float64(len(anchors))/float64(nonEmptyWindows) < SingleSpeakerWindowShare {
		return 0
	}
	for i := range anchors {
		for j := i + 1; j < len(anchors); j++ {
			if cosine(anchors[i].centroid, anchors[j].centroid) < SingleSpeakerAnchorSimilarity {
				return 0
			}
		}
	}
	bySpeaker := make(map[int][]int)
	for i, span := range spans {
		if !span.vetoOnly {
			bySpeaker[span.speaker] = append(bySpeaker[span.speaker], i)
		}
	}
	top, topSeconds, totalSeconds := 0, 0.0, 0.0
	for _, speaker := range sortedIntKeys(bySpeaker) {
		seconds, _ := metricFor(bySpeaker[speaker], spans)
		totalSeconds += seconds
		if seconds > topSeconds || seconds == topSeconds && speaker < top {
			top, topSeconds = speaker, seconds
		}
	}
	if totalSeconds == 0 || topSeconds/totalSeconds < DominantSpeakerShare {
		return 0
	}
	for _, anchor := range anchors {
		bySpeaker := make(map[int][][2]float64)
		for _, interval := range anchor.intervals {
			for _, span := range spans {
				if seconds := overlap(interval[0], interval[1], span.start, span.end); seconds > 0 {
					bySpeaker[span.speaker] = append(bySpeaker[span.speaker], [2]float64{math.Max(interval[0], span.start), math.Min(interval[1], span.end)})
				}
			}
		}
		topSeconds, totalSeconds := 0.0, 0.0
		for _, speaker := range sortedIntKeys(bySpeaker) {
			seconds := unionSeconds(bySpeaker[speaker])
			totalSeconds += seconds
			if speaker == top {
				topSeconds = seconds
			}
		}
		if totalSeconds == 0 || topSeconds/totalSeconds < SingleSpeakerAnchorDominance {
			return 0
		}
	}
	return top
}

func candidateLess(left, right candidate) bool {
	return left.score > right.score || left.score == right.score && (left.local < right.local || left.local == right.local && left.speaker < right.speaker)
}

func sortedIntKeys[V any](values map[int]V) []int {
	keys := make([]int, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Ints(keys)
	return keys
}
func align(phrases []Phrase, spans []stitchedSpan) ([]db.SpeakerProjectionAssignment, int, float64) {
	return alignWithSuppressed(phrases, spans, nil)
}

func alignWithSuppressed(phrases []Phrase, spans []stitchedSpan, suppressed map[int]bool) ([]db.SpeakerProjectionAssignment, int, float64) {
	hidden := make(map[int]bool, len(suppressed))
	for speaker, value := range suppressed {
		hidden[speaker] = value
	}
	suppressed = hidden
	bySpeaker, rawBySpeaker := make(map[int][]int), make(map[int][]int)
	for i, span := range spans {
		if span.vetoOnly {
			continue
		}
		rawBySpeaker[span.speaker] = append(rawBySpeaker[span.speaker], i)
		if span.confidence >= VisibleSpanThreshold {
			bySpeaker[span.speaker] = append(bySpeaker[span.speaker], i)
		}
	}
	eligible := 0.0
	active := make(map[int]db.SpeakerAssignmentReason)
	for _, speaker := range sortedIntKeys(bySpeaker) {
		value, turns := metricFor(bySpeaker[speaker], spans)
		eligible += value
		if !suppressed[speaker] && value >= ActiveSpeakerSeconds && turns >= ActiveSpeakerTurns {
			active[speaker] = db.SpeakerAssignmentReasonThresholdAssignment
		}
	}
	top, topSeconds, rawSeconds := 0, -1.0, 0.0
	for _, speaker := range sortedIntKeys(rawBySpeaker) {
		value, _ := metricFor(rawBySpeaker[speaker], spans)
		rawSeconds += value
		if value > topSeconds || value == topSeconds && speaker < top {
			top, topSeconds = speaker, value
		}
	}
	weakRivals := len(active) == 0 || len(active) == 1 && active[top] != ""
	if len(suppressed) == 0 && rawSeconds > 0 && topSeconds/rawSeconds >= DominantSpeakerShare && weakRivals && (len(rawBySpeaker) > 1 || active[top] == "") {
		active[top] = db.SpeakerAssignmentReasonDominantFallback
		for speaker := range rawBySpeaker {
			if speaker != top {
				suppressed[speaker] = true
				delete(active, speaker)
			}
		}
	}
	var selected map[int]bool
	if len(active) == 0 && eligible > 0 {
		candidates := make(map[int][]int)
		for speaker, indexes := range bySpeaker {
			if !suppressed[speaker] {
				candidates[speaker] = indexes
			}
		}
		if len(candidates) > 0 {
			top, selected = strongestTurn(spans, candidates)
			active[top] = db.SpeakerAssignmentReasonSingleTurnFallback
		}
	}
	assignments := make([]db.SpeakerProjectionAssignment, 0, len(phrases))
	visible := make(map[int]db.VisibleSpeaker)
	totalDuration, assignedDuration := 0.0, 0.0
	for _, phrase := range phrases {
		duration := phrase.EndSeconds - phrase.StartSeconds
		totalDuration += duration
		support, rawIntervals := make(map[int]float64), make(map[int][][2]float64)
		visibleSupport := make(map[int]bool)
		var intervals [][2]float64
		vetoSpeakers := make(map[int]bool)
		for i, span := range spans {
			seconds := overlap(phrase.StartSeconds, phrase.EndSeconds, span.start, span.end)
			if seconds <= 0 {
				continue
			}
			if span.vetoOnly || suppressed[span.speaker] {
				vetoSpeakers[span.speaker] = true
				continue
			}
			reason := active[span.speaker]
			if span.confidence < VisibleSpanThreshold || reason == db.SpeakerAssignmentReasonSingleTurnFallback && !selected[i] {
				continue
			}
			speaker := span.speaker
			interval := [2]float64{math.Max(phrase.StartSeconds, span.start), math.Min(phrase.EndSeconds, span.end)}
			support[speaker] += seconds * span.confidence
			rawIntervals[speaker] = append(rawIntervals[speaker], interval)
			intervals = append(intervals, interval)
			if reason != "" {
				visibleSupport[speaker] = true
			}
		}
		raw := make(map[int]float64, len(rawIntervals))
		for _, speaker := range sortedIntKeys(rawIntervals) {
			raw[speaker] = unionSeconds(rawIntervals[speaker])
		}
		winner, winnerSupport, totalSupport := 0, 0.0, 0.0
		for _, speaker := range sortedIntKeys(support) {
			value := support[speaker]
			totalSupport += value
			if value > winnerSupport || value == winnerSupport && speaker < winner {
				winner, winnerSupport = speaker, value
			}
		}
		share, rawShare, covered, meanConfidence := 0.0, 0.0, unionSeconds(intervals)/duration, 0.0
		if totalSupport > 0 {
			share = winnerSupport / totalSupport
			meanConfidence = winnerSupport / raw[winner]
			rawTotal := 0.0
			for _, speaker := range sortedIntKeys(raw) {
				rawTotal += raw[speaker]
			}
			if rawTotal > 0 {
				rawShare = raw[winner] / rawTotal
			}
		}
		hasVeto := false
		for speaker := range vetoSpeakers {
			if speaker != winner {
				hasVeto = true
				break
			}
		}
		winnerThreshold := HighCoverageWinnerShareThreshold
		if len(suppressed) > 0 {
			winnerThreshold = AmbiguousSupportThreshold
		}
		highCoverage := covered >= PhraseCoverageThreshold && share >= winnerThreshold && rawShare >= winnerThreshold
		guardedCoverage := covered >= GuardedPhraseCoverageThreshold && share >= GuardedWinnerShareThreshold && rawShare >= GuardedWinnerShareThreshold && meanConfidence >= GuardedMeanConfidenceThreshold
		qualified := !hasVeto && (highCoverage || guardedCoverage)
		assignment := db.SpeakerProjectionAssignment{SegmentID: phrase.SegmentID, Speaker: db.VisibleSpeakerOther, Reason: db.SpeakerAssignmentReasonNoEvidence}
		if hasVeto || totalSupport > 0 && (share < AmbiguousSupportThreshold || rawShare < winnerThreshold) {
			assignment.Reason = db.SpeakerAssignmentReasonAmbiguousSupport
		} else if totalSupport > 0 && covered < PhraseCoverageThreshold {
			assignment.Reason = db.SpeakerAssignmentReasonInsufficientCoverage
		}
		if totalSupport > 0 && qualified && visibleSupport[winner] {
			label, found := visible[winner]
			if !found {
				label = db.VisibleSpeaker(fmt.Sprintf("Speaker %d", len(visible)+1))
				visible[winner] = label
			}
			confidence := math.Min(meanConfidence, math.Min(share, covered))
			assignment.Speaker, assignment.Confidence, assignment.Reason = label, &confidence, active[winner]
			assignedDuration += duration
		}
		assignments = append(assignments, assignment)
	}
	if totalDuration > 0 {
		assignedDuration /= totalDuration
	}
	return assignments, len(visible), assignedDuration
}

func metricFor(indexes []int, spans []stitchedSpan) (float64, int) {
	intervals := make([][2]float64, 0, len(indexes))
	for _, i := range indexes {
		intervals = append(intervals, [2]float64{spans[i].start, spans[i].end})
	}
	return intervalMetric(intervals)
}

func strongestTurn(spans []stitchedSpan, bySpeaker map[int][]int) (int, map[int]bool) {
	var best []int
	bestScore, bestStart, bestSpeaker := -1.0, 0.0, 0
	for speaker, indexes := range bySpeaker {
		for at := 0; at < len(indexes); {
			first, start, end, score := at, spans[indexes[at]].start, spans[indexes[at]].end, 0.0
			for at < len(indexes) && spans[indexes[at]].start <= end {
				span := spans[indexes[at]]
				score += (span.end - span.start) * span.confidence
				end, at = math.Max(end, span.end), at+1
			}
			if score > bestScore || score == bestScore && (start < bestStart || start == bestStart && speaker < bestSpeaker) {
				best, bestScore, bestStart, bestSpeaker = append(best[:0], indexes[first:at]...), score, start, speaker
			}
		}
	}
	selected := make(map[int]bool, len(best))
	for _, i := range best {
		selected[i] = true
	}
	return bestSpeaker, selected
}

func unionSeconds(intervals [][2]float64) float64 {
	seconds, _ := intervalMetric(intervals)
	return seconds
}
func intervalMetric(intervals [][2]float64) (float64, int) {
	sort.Slice(intervals, func(i, j int) bool {
		return intervals[i][0] < intervals[j][0] || intervals[i][0] == intervals[j][0] && intervals[i][1] < intervals[j][1]
	})
	seconds, turns, end := 0.0, 0, -1.0
	for _, interval := range intervals {
		if interval[0] > end {
			seconds, turns = seconds+interval[1]-interval[0], turns+1
		} else if interval[1] > end {
			seconds += interval[1] - end
		}
		end = math.Max(end, interval[1])
	}
	return seconds, turns
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
func overlap(aStart, aEnd, bStart, bEnd float64) float64 {
	return math.Max(0, math.Min(aEnd, bEnd)-math.Max(aStart, bStart))
}
func clamp(value float64) float64 { return math.Max(0, math.Min(1, value)) }
func finite(values ...float64) bool {
	return !slices.ContainsFunc(values, func(value float64) bool { return math.IsNaN(value) || math.IsInf(value, 0) })
}
