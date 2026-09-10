package ai

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

type agendaSection struct {
	AgendaSource
	TextStart int `json:"textStart"`
}

type agendaCandidate struct {
	AgendaItem
	QuoteStart int `json:"quoteStart"`
}

type agendaSelection struct {
	AgendaItem
	RetainedIndex   *int `json:"retainedIndex"`
	QuoteOccurrence *int `json:"quoteOccurrence"`
}

var agendaRollingSchema = strings.Replace(strings.Replace(agendaSchema, `"topic":{"type":"string"}`, `"retainedIndex":{"type":"integer","minimum":-1,"maximum":7},"quoteOccurrence":{"type":"integer","minimum":0},"topic":{"type":"string"}`, 1), `"required":["topic","sourceId","quote"]`, `"required":["topic","sourceId","quote","retainedIndex","quoteOccurrence"]`, 1)

func validateRollingAgenda(raw json.RawMessage, section agendaSection, items []agendaCandidate) ([]agendaCandidate, error) {
	var response struct {
		Items []agendaSelection `json:"items"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, err
	}
	if response.Items == nil || len(response.Items) > 8 {
		return nil, fmt.Errorf("agenda: invalid candidate count")
	}
	result := []agendaCandidate{}
	for _, selection := range response.Items {
		item, err := resolveAgendaSelection(selection, section, items)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	state, _ := json.Marshal(result)
	if len(state) > agendaStateBytes {
		return nil, agendaLimit()
	}
	return result, nil
}

func resolveAgendaSelection(selection agendaSelection, section agendaSection, items []agendaCandidate) (agendaCandidate, error) {
	invalid := fmt.Errorf("agenda: unsupported rolling candidate evidence")
	if len(selection.Topic) > 240 || strings.TrimSpace(selection.Topic) == "" || selection.RetainedIndex == nil || selection.QuoteOccurrence == nil {
		return agendaCandidate{}, invalid
	}
	index := *selection.RetainedIndex
	if index >= 0 && index < len(items) {
		prior := items[index]
		if selection.SourceID != prior.SourceID || selection.Quote != prior.Quote {
			return agendaCandidate{}, invalid
		}
		prior.Topic = selection.Topic
		return prior, nil
	}
	if index != -1 || selection.SourceID != section.ID {
		return agendaCandidate{}, invalid
	}
	start, err := agendaQuoteStart(section, selection.Quote, *selection.QuoteOccurrence)
	if err != nil {
		return agendaCandidate{}, err
	}
	return agendaCandidate{selection.AgendaItem, start}, nil
}

// The model identifies an occurrence, not a byte count. The host calculates the
// exact position, including multibyte text and repeated boundary context.
func agendaQuoteStart(section agendaSection, quote string, occurrence int) (int, error) {
	invalid := fmt.Errorf("agenda: unsupported quote occurrence")
	if occurrence < 0 || len(strings.TrimSpace(quote)) < 12 || len(quote) > 240 || !utf8.ValidString(quote) {
		return 0, invalid
	}
	text, start := section.Text, 0
	for n := 0; n <= occurrence; n++ {
		found := strings.Index(text, quote)
		if found < 0 {
			return 0, invalid
		}
		start += found
		if n == occurrence {
			if !utf8.ValidString(section.Text[:start]) {
				return 0, invalid
			}
			return section.TextStart + start, nil
		}
		start += len(quote)
		text = section.Text[start:]
	}
	return 0, invalid
}
