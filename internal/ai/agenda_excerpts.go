package ai

import "strings"

const agendaExcerptBytes = 240

type agendaExcerpt struct {
	Index int    `json:"index"`
	Quote string `json:"quote"`
}

type agendaExcerptSection struct {
	agendaSection
	Excerpts []agendaExcerpt `json:"excerpts"`
}

// Keep source order and exact byte positions. Only whitespace between excerpts
// is removed; no words are normalized, reconstructed, or joined across gaps.
func agendaCorrectionEvidence(section agendaSection, prior []agendaCandidate) (agendaExcerptSection, []agendaCandidate) {
	source := agendaExcerptSection{agendaSection: section}
	source.Text = ""
	evidence := append([]agendaCandidate(nil), prior...)
	for offset := 0; offset < len(section.Text); {
		cut := agendaExcerptCut(section.Text[offset:])
		text := section.Text[offset : offset+cut]
		quote := strings.TrimSpace(text)
		if quote != "" {
			index := -1 // Short statements remain visible as resolution context.
			if len(quote) >= 12 {
				index = len(evidence)
				start := section.TextStart + offset + strings.Index(text, quote)
				evidence = append(evidence, agendaCandidate{AgendaItem{SourceID: section.ID, Quote: quote}, start})
			}
			source.Excerpts = append(source.Excerpts, agendaExcerpt{index, quote})
		}
		offset += cut
	}
	return source, evidence
}

func agendaExcerptCut(text string) int {
	cut := agendaChunkCut(text, agendaExcerptBytes)
	// Prefer the last sentence boundary to keep excerpt metadata bounded.
	if boundary := strings.LastIndexAny(text[:cut], ".!?\n"); boundary >= cut/2 {
		return boundary + 1
	}
	if cut < len(text) {
		if space := strings.LastIndexAny(text[:cut], " \n\t"); space >= 12 {
			return space + 1
		}
	}
	return cut
}
