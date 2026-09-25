package diarize

import (
	"fmt"
	"sort"

	"github.com/gappd-dev/gappd/internal/db"
)

func Transform(in Input) (Output, error) {
	if err := validate(in); err != nil {
		return Output{}, err
	}
	spans, vectors := stitchWindows(in.Windows)
	assignments, coverage, visible := projectPhrases(in, spans)
	labels := compactSpeakerLabels(assignments)
	return speakerOutput(in.HasMicrophoneSpeech, assignments, coverage, visible, labels, vectors, spans), nil
}

func projectPhrases(in Input, spans []stitchedSpan) ([]db.SpeakerProjectionAssignment, float64, map[int]db.VisibleSpeaker) {
	suppressed := minoritySpeakers(in.Windows, spans)
	visible := make(map[int]db.VisibleSpeaker)
	assignments, coverage := alignWithVisible(in.Phrases, spans, suppressed, visible)
	if len(in.ProjectionGroups) == 0 {
		return assignments, coverage, visible
	}
	return groupedAssignments(in, spans, suppressed, visible, assignments)
}

func minoritySpeakers(windows []WindowReport, spans []stitchedSpan) map[int]bool {
	suppressed := make(map[int]bool)
	speaker := singleSpeakerConsensus(windows, spans)
	if speaker == 0 {
		return suppressed
	}
	for _, span := range spans {
		if !span.vetoOnly && span.speaker != speaker {
			suppressed[span.speaker] = true
		}
	}
	return suppressed
}

func groupedAssignments(
	in Input,
	spans []stitchedSpan,
	suppressed map[int]bool,
	visible map[int]db.VisibleSpeaker,
	assignments []db.SpeakerProjectionAssignment,
) ([]db.SpeakerProjectionAssignment, float64, map[int]db.VisibleSpeaker) {
	groupPhrases := make([]Phrase, len(in.ProjectionGroups))
	for i, group := range in.ProjectionGroups {
		groupPhrases[i] = group.Phrase
	}
	groupAssigned, _ := alignWithVisible(groupPhrases, spans, suppressed, visible)
	assignments = preserveGroupAssignments(assignments, in.Phrases, groupAssigned, in.ProjectionGroups)
	return assignments, assignmentCoverage(assignments, in.Phrases), visible
}

func speakerOutput(
	hasMic bool,
	assignments []db.SpeakerProjectionAssignment,
	coverage float64,
	visible map[int]db.VisibleSpeaker,
	labels map[db.VisibleSpeaker]db.VisibleSpeaker,
	vectors map[int][]float64,
	spans []stitchedSpan,
) Output {
	count := len(labels)
	if hasMic {
		count++
	}
	return Output{Assignments: assignments, SpeakerCount: count, Coverage: coverage,
		Embeddings: labeledEmbeddings(visible, labels, vectors, spans)}
}

func labeledEmbeddings(
	visible map[int]db.VisibleSpeaker,
	labels map[db.VisibleSpeaker]db.VisibleSpeaker,
	vectors map[int][]float64,
	spans []stitchedSpan,
) []db.SpeakerEmbedding {
	out := make([]db.SpeakerEmbedding, 0, len(visible))
	for speaker, raw := range visible {
		key := labels[raw]
		if key == "" {
			continue
		}
		vector := vectors[speaker]
		if len(vector) == 0 {
			continue
		}
		seconds, quality := cleanClusterSpeech(speaker, spans)
		out = append(out, db.SpeakerEmbedding{Key: string(key), Vector: append([]float64(nil), vector...),
			Model: db.VoiceModel, Source: fmt.Sprintf("system/cluster:%d", speaker), Seconds: seconds, Quality: quality})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

func clusterVectors(globals map[int]*globalCluster) map[int][]float64 {
	out := make(map[int][]float64, len(globals))
	for speaker, cluster := range globals {
		if !cluster.unclean {
			out[speaker] = append([]float64(nil), cluster.centroid...)
		}
	}
	return out
}
