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
		if merged.Title == "" {
			merged.Title = extraction.Title
		}
		merged.Participants = append(merged.Participants, extraction.Participants...)
	}
	merged.Topics = fairTake(chunkLists(extractions, func(e *Extraction) []Topic { return e.Topics }), maxMergedTopics)
	merged.Decisions = fairTake(chunkLists(extractions, func(e *Extraction) []Decision { return e.Decisions }), maxMergedDecisions)
	merged.ActionItems = fairTake(chunkLists(extractions, func(e *Extraction) []ExtractedAction { return e.ActionItems }), maxMergedActionItems)
	merged.OpenQuestions = fairTake(chunkLists(extractions, func(e *Extraction) []string { return e.OpenQuestions }), maxMergedOpenQuestions)
	merged.Sentiment = mergedSentiment(extractions)
	return boundExtraction(&merged)
}

func chunkLists[T any](extractions []*Extraction, field func(*Extraction) []T) [][]T {
	lists := make([][]T, len(extractions))
	for index, extraction := range extractions {
		lists[index] = field(extraction)
	}
	return lists
}

// fairTake joins the chunks' items in Meeting order. When more than limit
// items exist, each chunk keeps an equal number of its first items, so a long
// Meeting keeps items from its end as well as its start.
func fairTake[T any](lists [][]T, limit int) []T {
	quota := 0
	for quota < limit && takenWithin(lists, quota+1) <= limit {
		quota++
	}
	spare := limit - takenWithin(lists, quota)
	var out []T
	for _, list := range lists {
		take := min(len(list), quota)
		if take < len(list) && spare > 0 {
			take++
			spare--
		}
		out = append(out, list[:take]...)
	}
	return out
}

// takenWithin counts the items kept when each chunk keeps at most quota items.
func takenWithin[T any](lists [][]T, quota int) int {
	total := 0
	for _, list := range lists {
		total += min(len(list), quota)
	}
	return total
}

func boundExtraction(extraction *Extraction) *Extraction {
	extraction.Title = compactString(extraction.Title)
	extraction.Participants = limitSlice(uniqueStrings(namedSpeakers(extraction.Participants)), maxMergedParticipants)
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
		value.WhoDecided = limitSlice(uniqueStrings(namedSpeakers(value.WhoDecided)), maxMergedParticipants)
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
