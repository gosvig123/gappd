package ai

import (
	"encoding/json"
	"errors"
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
	selections, err := parseAgendaSelections(raw)
	if err != nil {
		return nil, err
	}
	return resolveAgendaSelections(selections, section, items)
}

func resolveAgendaSelections(selections []agendaSelection, section agendaSection, items []agendaCandidate) ([]agendaCandidate, error) {
	result := []agendaCandidate{}
	rejected := []agendaRejectedSelection{}
	var invalid error
	for i, selection := range selections {
		item, err := resolveAgendaSelection(selection, section, items)
		var issue *agendaQuoteError
		if errors.As(err, &issue) && issue.failure == agendaAbsentNewQuote {
			rejected = append(rejected, agendaRejectedSelection{i, issue.failure, selection})
		} else {
			invalid = errors.Join(invalid, err)
		}
		if err != nil {
			// Include rejected candidates in the serialized state bound before retry.
			item = agendaCandidate{selection.AgendaItem, section.TextStart + len(section.Text)}
		}
		result = append(result, item)
	}
	return checkedAgendaSelections(result, rejected, invalid)
}

func checkedAgendaSelections(items []agendaCandidate, rejected []agendaRejectedSelection, invalid error) ([]agendaCandidate, error) {
	if invalid != nil {
		return nil, invalid
	}
	state, _ := json.Marshal(items)
	if len(state) > agendaStateBytes {
		return nil, agendaLimit()
	}
	if len(rejected) > 0 {
		return nil, &agendaMissingQuotesError{rejected}
	}
	return items, nil
}

func resolveAgendaSelection(selection agendaSelection, section agendaSection, items []agendaCandidate) (agendaCandidate, error) {
	invalid := fmt.Errorf("agenda: unsupported rolling candidate evidence")
	if len(selection.Topic) > 240 || strings.TrimSpace(selection.Topic) == "" || !utf8.ValidString(selection.Topic) || selection.RetainedIndex == nil || selection.QuoteOccurrence == nil {
		return agendaCandidate{}, invalid
	}
	if err := validateAgendaQuote(selection.Quote, *selection.QuoteOccurrence); err != nil {
		return agendaCandidate{}, err
	}
	index := *selection.RetainedIndex
	if index >= 0 && index < len(items) {
		return retainedAgendaSelection(selection, items[index])
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

func retainedAgendaSelection(selection agendaSelection, prior agendaCandidate) (agendaCandidate, error) {
	if selection.SourceID != prior.SourceID || selection.Quote != prior.Quote {
		return agendaCandidate{}, fmt.Errorf("agenda: changed retained evidence")
	}
	prior.Topic = selection.Topic
	return prior, nil
}

// The model identifies an occurrence, not a byte count. The host calculates the
// exact position, including multibyte text and repeated boundary context.
func agendaQuoteStart(section agendaSection, quote string, occurrence int) (int, error) {
	if err := validateAgendaQuote(quote, occurrence); err != nil {
		return 0, err
	}
	if !utf8.ValidString(section.Text) {
		return 0, &agendaQuoteError{agendaBadQuoteUTF8}
	}
	start := 0
	for n := 0; n <= occurrence; n++ {
		found := strings.Index(section.Text[start:], quote)
		if found < 0 {
			return 0, missingAgendaOccurrence(occurrence, n)
		}
		start += found
		if n == occurrence {
			return section.TextStart + start, nil
		}
		start += len(quote)
	}
	return 0, &agendaQuoteError{agendaBadQuoteOrdinal}
}
