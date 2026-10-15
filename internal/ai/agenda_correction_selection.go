package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

func validateAgendaCorrection(raw json.RawMessage, evidence []agendaCandidate) ([]agendaCandidate, error) {
	if !json.Valid(raw) || !utf8.Valid(raw) || !agendaJSONUnicodeValid(raw) {
		return nil, fmt.Errorf("agenda: malformed correction response")
	}
	fields, err := agendaJSONObject(raw, "items")
	if err != nil {
		return nil, err
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(fields["items"], &entries); err != nil || entries == nil || len(entries) > 8 {
		return nil, fmt.Errorf("agenda: invalid correction array")
	}
	items := make([]agendaCandidate, len(entries))
	for i, entry := range entries {
		items[i], err = resolveAgendaCorrection(entry, evidence)
		if err != nil {
			return nil, err
		}
	}
	return checkedAgendaSelections(items, nil, nil)
}

func resolveAgendaCorrection(raw json.RawMessage, evidence []agendaCandidate) (agendaCandidate, error) {
	fields, err := agendaJSONObject(raw, "topic", "evidenceIndex")
	if err != nil {
		return agendaCandidate{}, err
	}
	var selection struct {
		Topic string `json:"topic"`
		Index *int   `json:"evidenceIndex"`
	}
	if err := json.Unmarshal(raw, &selection); err != nil || bytes.Equal(bytes.TrimSpace(fields["topic"]), []byte("null")) {
		return agendaCandidate{}, fmt.Errorf("agenda: invalid correction selection")
	}
	if selection.Index == nil || *selection.Index < 0 || *selection.Index >= len(evidence) || strings.TrimSpace(selection.Topic) == "" || len(selection.Topic) > 240 {
		return agendaCandidate{}, fmt.Errorf("agenda: unsupported correction evidence")
	}
	item := evidence[*selection.Index]
	if err := validateAgendaQuote(item.Quote, 0); err != nil {
		return agendaCandidate{}, err
	}
	item.Topic = selection.Topic
	return item, nil
}
