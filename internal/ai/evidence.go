package ai

import "strings"

const minEvidenceQuoteWords = 4

func requireSupportedEvidence(extraction *Extraction, transcript string) *Extraction {
	if extraction == nil {
		return extraction
	}
	extraction.Topics = filterTopicsWithSupportedEvidence(extraction.Topics, transcript)
	extraction.Decisions = filterDecisionsWithSupportedEvidence(extraction.Decisions, transcript)
	extraction.ActionItems = filterActionsWithSupportedEvidence(extraction.ActionItems, transcript)
	return extraction
}

func requireEvidence(extraction *Extraction) *Extraction {
	if extraction == nil {
		return extraction
	}
	extraction.Topics = filterTopicsWithEvidence(extraction.Topics)
	extraction.Decisions = filterDecisionsWithEvidence(extraction.Decisions)
	extraction.ActionItems = filterActionsWithEvidence(extraction.ActionItems)
	return extraction
}

func filterTopicsWithSupportedEvidence(values []Topic, transcript string) []Topic {
	out := make([]Topic, 0, len(values))
	for _, value := range values {
		if evidenceSupported(value.Evidence, transcript) {
			out = append(out, value)
		}
	}
	return out
}

func filterDecisionsWithSupportedEvidence(values []Decision, transcript string) []Decision {
	out := make([]Decision, 0, len(values))
	for _, value := range values {
		if evidenceSupported(value.Evidence, transcript) {
			out = append(out, value)
		}
	}
	return out
}

func filterActionsWithSupportedEvidence(values []ExtractedAction, transcript string) []ExtractedAction {
	out := make([]ExtractedAction, 0, len(values))
	for _, value := range values {
		if evidenceSupported(value.Evidence, transcript) {
			out = append(out, value)
		}
	}
	return out
}

func filterTopicsWithEvidence(values []Topic) []Topic {
	out := make([]Topic, 0, len(values))
	for _, value := range values {
		if len(value.Evidence) > 0 {
			out = append(out, value)
		}
	}
	return out
}

func filterDecisionsWithEvidence(values []Decision) []Decision {
	out := make([]Decision, 0, len(values))
	for _, value := range values {
		if len(value.Evidence) > 0 {
			out = append(out, value)
		}
	}
	return out
}

func filterActionsWithEvidence(values []ExtractedAction) []ExtractedAction {
	out := make([]ExtractedAction, 0, len(values))
	for _, value := range values {
		if len(value.Evidence) > 0 {
			out = append(out, value)
		}
	}
	return out
}

func evidenceSupported(evidence []EvidenceQuote, transcript string) bool {
	for _, quote := range evidence {
		if quoteSupportedByTranscript(quote.Text, transcript) {
			return true
		}
	}
	return false
}

func quoteSupportedByTranscript(quote string, transcript string) bool {
	quoteWords := evidenceWords(quote)
	if len(quoteWords) < minEvidenceQuoteWords {
		return false
	}
	return strings.Contains(strings.Join(evidenceWords(transcript), " "), strings.Join(quoteWords, " "))
}

func evidenceWords(value string) []string {
	words := wordPattern.FindAllString(strings.ToLower(value), -1)
	out := make([]string, 0, len(words))
	for _, word := range words {
		out = append(out, stemGroundingWord(word))
	}
	return out
}
