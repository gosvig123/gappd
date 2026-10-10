package ai

import (
	"context"
	"encoding/json"
)

const agendaStateBytes = 6000
const agendaRollingSystem = agendaSystem + ` Process this chronological section and the retained candidates. Select at most 8 useful topics for the upcoming meeting; intentional topic prioritization is required, NOT exhaustive evidence extraction. Read every section, remove resolved/superseded candidates, and retain useful earlier candidates. An explicitly reopened commitment can replace a resolved one with its new quote. Cite either an unchanged retained quote or an exact quote in this section. Topics and quotes must each be at most 240 UTF-8 bytes. For retained candidates set retainedIndex to their array index and copy sourceId and quote unchanged. For a new quote use retainedIndex:-1 and quoteOccurrence as its zero-based occurrence within this section (not UTF-8 byte counting). Always supply both fields. Return items only.`

type agendaRollingInput struct {
	Title      string            `json:"upcomingTitle"`
	Sources    []agendaSection   `json:"sources"`
	Candidates []agendaCandidate `json:"candidates"`
}

func rollingAgendaInput(title string, section agendaSection, items []agendaCandidate) []byte {
	raw, _ := json.Marshal(agendaRollingInput{title, []agendaSection{section}, items})
	return raw
}

// Reserve the full serialized candidate budget before any provider spend.
func agendaSectionsForTitle(title string, sources []AgendaSource) ([]agendaSection, error) {
	if err := preflightAgendaMerge(title); err != nil {
		return nil, err
	}
	var sections []agendaSection
	overhead := max(len(agendaRollingSystem)+len(agendaRollingSchema), len(agendaReviewSystem)+len(agendaReviewSchema))
	for _, source := range sources {
		for text := source.Text; len(text) > 0; {
			section := agendaSection{AgendaSource: source, TextStart: len(source.Text) - len(text)}
			cut := agendaSectionCut(title, section, text, overhead)
			if cut == 0 || (cut <= 256 && cut < len(text)) {
				return nil, agendaLimit()
			}
			section.Text = text[:cut]
			sections = append(sections, section)
			if agendaHistoryCalls(len(sections)) > agendaMaxCalls {
				return nil, agendaLimit()
			}
			text = agendaSectionRemainder(text, cut)
		}
	}
	return sections, nil
}

func generateAgendaHistory(ctx context.Context, provider Provider, title string, sources []AgendaSource) (AgendaDraft, error) {
	if len(title) > 1000 {
		return AgendaDraft{}, agendaLimit()
	}
	sections, err := agendaSectionsForTitle(title, sources)
	if err != nil {
		return AgendaDraft{}, err
	}
	items, err := selectAgendaPartitions(ctx, provider, title, sources, sections)
	if err != nil {
		return AgendaDraft{}, err
	}
	return reviewAgendaCandidates(ctx, provider, title, sources, sections, items)
}

func rollAgendaSection(ctx context.Context, provider Provider, title string, section agendaSection, items []agendaCandidate) ([]agendaCandidate, error) {
	raw, err := agendaComplete(ctx, provider, agendaRollingSystem, agendaRollingSchema, rollingAgendaInput(title, section, items))
	if err != nil {
		return nil, err
	}
	result, err := validateRollingAgenda(raw, section, items)
	if err != nil {
		return correctAgendaSection(ctx, provider, title, section, items, err)
	}
	return result, nil
}

func agendaChunkCut(text string, limit int) int {
	if limit >= len(text) {
		return len(text)
	}
	return runeSafeCut(text, limit)
}

func agendaSectionCut(title string, source agendaSection, text string, overhead int) int {
	lo, hi := 0, len(text)
	for lo < hi {
		mid := (lo + hi + 1) / 2
		source.Text = text[:agendaChunkCut(text, mid)]
		if len(rollingAgendaInput(title, source, nil))+agendaStateBytes+overhead <= agendaRequestBytes {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return agendaChunkCut(text, lo)
}
