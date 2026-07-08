package ai

import "strings"

const (
	maxMergedParticipants  = 30
	maxMergedTopics        = 80
	maxMergedDecisions     = 80
	maxMergedActionItems   = 120
	maxMergedOpenQuestions = 80
	maxExtractionTextRunes = 500
)

func mergeExtractions(extractions []*Extraction) *Extraction {
	var merged Extraction
	for _, extraction := range extractions {
		mergeExtraction(&merged, extraction)
	}
	merged.Sentiment = mergedSentiment(extractions)
	return boundExtraction(&merged)
}

func mergeExtraction(dst *Extraction, src *Extraction) {
	if dst.Title == "" {
		dst.Title = src.Title
	}
	dst.Participants = append(dst.Participants, src.Participants...)
	dst.Topics = append(dst.Topics, src.Topics...)
	dst.Decisions = append(dst.Decisions, src.Decisions...)
	dst.ActionItems = append(dst.ActionItems, src.ActionItems...)
	dst.OpenQuestions = append(dst.OpenQuestions, src.OpenQuestions...)
}

func boundExtraction(extraction *Extraction) *Extraction {
	extraction.Title = compactString(extraction.Title)
	extraction.Participants = limitSlice(uniqueStrings(extraction.Participants), maxMergedParticipants)
	extraction.Topics = limitSlice(uniqueBy(cleanTopics(extraction.Topics), topicKey), maxMergedTopics)
	extraction.Decisions = limitSlice(uniqueBy(cleanDecisions(extraction.Decisions), decisionKey), maxMergedDecisions)
	extraction.ActionItems = limitSlice(uniqueBy(cleanActions(extraction.ActionItems), actionKey), maxMergedActionItems)
	extraction.OpenQuestions = limitSlice(uniqueStrings(extraction.OpenQuestions), maxMergedOpenQuestions)
	return extraction
}

func cleanTopics(values []Topic) []Topic {
	out := make([]Topic, 0, len(values))
	for _, value := range values {
		value.Name = compactString(value.Name)
		value.Summary = compactString(value.Summary)
		if value.Name != "" || value.Summary != "" {
			out = append(out, value)
		}
	}
	return out
}

func cleanDecisions(values []Decision) []Decision {
	out := make([]Decision, 0, len(values))
	for _, value := range values {
		value.What = compactString(value.What)
		value.Context = compactString(value.Context)
		value.WhoDecided = limitSlice(uniqueStrings(value.WhoDecided), maxMergedParticipants)
		if value.What != "" {
			out = append(out, value)
		}
	}
	return out
}

func cleanActions(values []ExtractedAction) []ExtractedAction {
	out := make([]ExtractedAction, 0, len(values))
	for _, value := range values {
		value.Task = compactString(value.Task)
		value.Owner = compactString(value.Owner)
		value.Deadline = compactString(value.Deadline)
		if value.Task != "" {
			out = append(out, value)
		}
	}
	return out
}

func uniqueStrings(values []string) []string {
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		if value = compactString(value); value != "" {
			cleaned = append(cleaned, value)
		}
	}
	return uniqueBy(cleaned, func(value string) string { return value })
}

func uniqueBy[T any](values []T, key func(T) string) []T {
	seen := map[string]bool{}
	out := make([]T, 0, len(values))
	for _, value := range values {
		nextKey := key(value)
		if nextKey == "" || seen[nextKey] {
			continue
		}
		seen[nextKey] = true
		out = append(out, value)
	}
	return out
}

func limitSlice[T any](values []T, limit int) []T {
	if len(values) <= limit {
		return values
	}
	return values[:limit]
}

func mergedSentiment(extractions []*Extraction) string {
	if len(extractions) == 0 {
		return "neutral"
	}
	first := extractions[0].Sentiment
	for _, extraction := range extractions {
		if extraction.Sentiment != first {
			return "neutral"
		}
	}
	return first
}

func compactString(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) <= maxExtractionTextRunes {
		return value
	}
	return string(runes[:maxExtractionTextRunes])
}

func topicKey(value Topic) string {
	return normalizedKey(value.Name + "\n" + value.Summary)
}

func decisionKey(value Decision) string {
	return normalizedKey(value.Status + "\n" + value.What + "\n" + strings.Join(value.WhoDecided, ",") + "\n" + value.Context)
}

func actionKey(value ExtractedAction) string {
	return normalizedKey(value.Task + "\n" + value.Owner + "\n" + value.Deadline)
}

func normalizedKey(value string) string {
	return strings.ToLower(compactString(value))
}
