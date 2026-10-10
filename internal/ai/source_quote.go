package ai

import (
	"regexp"
	"strings"
)

// quotedSpan finds text that a model wrapped in quotation marks inside a paraphrased quote.
var quotedSpan = regexp.MustCompile(`['"‘“]([^'"‘’“”]{12,})['"’”]`)

// citedEvidence finds the supplied source and exact text that support a model citation. It prefers
// the cited source and falls back to another supplied source when the model misattributes the quote.
// An invented source ID is always rejected.
func citedEvidence(sources []AgendaSource, sourceID, quote string) (string, string, bool) {
	cited := false
	for _, source := range sources {
		if source.ID == sourceID {
			cited = true
			if text, found := sourceQuote(source.Text, quote); found {
				return source.ID, text, true
			}
		}
	}
	if !cited {
		return "", "", false
	}
	for _, source := range sources {
		if text, found := sourceQuote(source.Text, quote); found {
			return source.ID, text, true
		}
	}
	return "", "", false
}

// sourceQuote returns the exact source text that a model quote cites. Small local models
// often paraphrase around a verbatim span, and Gmail hard-wraps plain text, so the quote
// or a quoted span inside it may match the source with different whitespace or case.
// The returned text is always a substring of the source.
func sourceQuote(text, quote string) (string, bool) {
	if strings.Contains(text, quote) && len(strings.TrimSpace(quote)) >= 12 {
		return quote, true
	}
	candidates := []string{quote}
	for _, match := range quotedSpan.FindAllStringSubmatch(quote, -1) {
		candidates = append(candidates, match[1])
	}
	best := ""
	for _, candidate := range candidates {
		words := strings.Fields(candidate)
		if len(strings.Join(words, " ")) < 12 {
			continue
		}
		for i, word := range words {
			words[i] = regexp.QuoteMeta(word)
		}
		if found := regexp.MustCompile(`(?i)` + strings.Join(words, `\s+`)).FindString(text); len(found) > len(best) {
			best = found
		}
	}
	return best, best != ""
}
