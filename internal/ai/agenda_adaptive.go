package ai

import (
	"context"
	"errors"
	"fmt"
)

// AgendaCapacityError means local finite processing limits, not provider configuration.
type AgendaCapacityError struct{ Reason string }

func (e *AgendaCapacityError) Error() string {
	return "agenda: " + e.Reason + "; prepare this agenda manually from matched Meetings; no draft was generated"
}

const agendaMaxCalls = 97
const agendaMinSplitBytes = 64

var errAgendaIncomplete = errors.New("agenda: incomplete section")

type agendaBudgetKey struct{}
type agendaCallBudget struct{ used int }

func spendAgendaCall(ctx context.Context) error {
	budget, _ := ctx.Value(agendaBudgetKey{}).(*agendaCallBudget)
	if budget == nil {
		return nil
	}
	if budget.used >= agendaMaxCalls {
		return &AgendaCapacityError{Reason: "97 model-request budget exhausted"}
	}
	budget.used++
	return nil
}

func adaptiveAgendaSection(ctx context.Context, provider Provider, title string, section AgendaSource) ([]AgendaItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if budget, ok := ctx.Value(agendaBudgetKey{}).(*agendaCallBudget); ok && budget.used >= agendaMaxCalls-1 {
		return nil, &AgendaCapacityError{Reason: "extraction exhausted 96 model requests (97 total, one reserved for synthesis)"}
	}
	items, err := extractAgendaSection(ctx, provider, title, section)
	if !errors.Is(err, errAgendaIncomplete) {
		return items, err
	}
	children, err := splitAgendaSection(section)
	if err != nil {
		return nil, err
	}
	return collectAgendaChildren(ctx, provider, title, children)
}

func collectAgendaChildren(ctx context.Context, provider Provider, title string, children []AgendaSource) ([]AgendaItem, error) {
	var result []AgendaItem
	for _, child := range children {
		items, err := adaptiveAgendaSection(ctx, provider, title, child)
		if err != nil {
			return nil, err
		}
		result = append(result, items...)
	}
	return result, nil
}

func splitAgendaSection(section AgendaSource) ([]AgendaSource, error) {
	text := section.Text
	if len(text) <= agendaMinSplitBytes {
		return nil, &AgendaCapacityError{Reason: fmt.Sprintf("extraction remains incomplete at minimum section size (%d bytes; 64-byte split floor)", len(text))}
	}
	middle := runeSafeCut(text, len(text)/2)
	overlap := len(text) / 8
	if overlap > 128 {
		overlap = 128
	}
	end := runeSafeCut(text, middle+overlap)
	start := runeSafeCut(text, middle-overlap)
	if start <= 0 || end >= len(text) || end <= start {
		return nil, &AgendaCapacityError{Reason: "extraction cannot split further safely"}
	}
	left, right := section, section
	left.Text, right.Text = text[:end], text[start:]
	return []AgendaSource{left, right}, nil
}

// Group by Meeting and remove only identical evidence, including its description.
func appendAgendaEvidence(ledger []agendaSectionEvidence, section AgendaSource, items []AgendaItem) []agendaSectionEvidence {
	index := len(ledger) - 1
	if index < 0 || ledger[index].ID != section.ID {
		ledger = append(ledger, agendaSectionEvidence{ID: section.ID, StartedAt: section.StartedAt, Items: []AgendaItem{}})
		index++
	}
	seen := make(map[AgendaItem]bool, len(ledger[index].Items))
	for _, item := range ledger[index].Items {
		seen[item] = true
	}
	for _, item := range items {
		if !seen[item] {
			ledger[index].Items = append(ledger[index].Items, item)
			seen[item] = true
		}
	}
	return ledger
}
