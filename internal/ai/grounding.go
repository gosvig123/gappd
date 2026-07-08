package ai

import (
	"regexp"
	"strings"
)

const minGroundedExtractionRatio = 0.10

var wordPattern = regexp.MustCompile(`[A-Za-z][A-Za-z0-9-]*`)

var groundingStopWords = map[string]bool{
	"the": true, "and": true, "that": true, "this": true, "meeting": true,
	"summary": true, "topic": true, "topics": true, "notes": true, "with": true,
	"from": true, "they": true, "them": true, "you": true, "your": true,
}

func groundExtraction(extraction *Extraction, transcript string) *Extraction {
	bounded := boundExtraction(extraction)
	beforeClaims := claimCount(bounded)
	grounded := requireSupportedEvidence(bounded, transcript)
	if supportedClaimsDropped(beforeClaims, grounded) {
		return conservativeExtraction(transcript)
	}
	if !needsConservativeExtraction(grounded, transcript) {
		return grounded
	}
	return conservativeExtraction(transcript)
}

func supportedClaimsDropped(beforeClaims int, after *Extraction) bool {
	if beforeClaims == 0 {
		return false
	}
	return claimCount(after) == 0
}

func claimCount(extraction *Extraction) int {
	return len(extraction.Topics) + len(extraction.Decisions) + len(extraction.ActionItems)
}

func needsConservativeExtraction(extraction *Extraction, transcript string) bool {
	extractionTerms := contentTerms(extractionText(extraction))
	if len(extractionTerms) == 0 {
		return false
	}
	return overlapRatio(contentTerms(transcript), extractionTerms) < minGroundedExtractionRatio
}

func conservativeExtraction(transcript string) *Extraction {
	return &Extraction{
		Title:         "Transcript Notes",
		Topics:        []Topic{{Name: "Transcript excerpt", Summary: compactString(transcript)}},
		OpenQuestions: transcriptQuestions(transcript),
		Sentiment:     "neutral",
	}
}

func extractionText(extraction *Extraction) string {
	parts := []string{extraction.Title, extraction.Sentiment}
	parts = append(parts, extraction.Participants...)
	for _, topic := range extraction.Topics {
		parts = append(parts, topic.Name, topic.Summary)
	}
	for _, decision := range extraction.Decisions {
		parts = append(parts, decision.What, strings.Join(decision.WhoDecided, " "), decision.Context)
	}
	for _, action := range extraction.ActionItems {
		parts = append(parts, action.Task, action.Owner, action.Deadline)
	}
	parts = append(parts, extraction.OpenQuestions...)
	return strings.Join(parts, " ")
}

func overlapRatio(transcriptTerms map[string]bool, extractionTerms map[string]bool) float64 {
	overlap := 0
	for term := range extractionTerms {
		if transcriptTerms[term] {
			overlap++
		}
	}
	return float64(overlap) / float64(len(extractionTerms))
}

func contentTerms(value string) map[string]bool {
	terms := map[string]bool{}
	for _, word := range wordPattern.FindAllString(strings.ToLower(value), -1) {
		if keepGroundingWord(word) {
			terms[stemGroundingWord(word)] = true
		}
	}
	return terms
}

func keepGroundingWord(word string) bool {
	return len(word) > 2 && !groundingStopWords[word]
}

func stemGroundingWord(word string) string {
	for _, suffix := range []string{"ation", "ing", "ers", "ed", "es", "s"} {
		if len(word) > len(suffix)+3 && strings.HasSuffix(word, suffix) {
			return strings.TrimSuffix(word, suffix)
		}
	}
	return word
}

func transcriptQuestions(transcript string) []string {
	questions := []string{}
	for _, part := range strings.Split(transcript, "\n") {
		if question := compactQuestion(part); question != "" {
			questions = append(questions, question)
		}
	}
	return limitSlice(uniqueStrings(questions), maxMergedOpenQuestions)
}

func compactQuestion(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "[Other]"))
	value = strings.TrimSpace(strings.TrimPrefix(value, "[You]"))
	if !strings.HasSuffix(value, "?") {
		return ""
	}
	return compactString(value)
}
