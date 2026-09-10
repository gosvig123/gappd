package ai

import (
	"context"
	"encoding/json"
	"errors"
)

const agendaCorrectionSystem = agendaRollingSystem + ` The prior response failed exact quote validation. rejectedSelections contains every failed new selection and its original response index. Return a complete replacement items array for this same section and original retained candidate state, not a patch. Copy new quotes exactly, case-sensitively, from the source text; do not normalize capitalization or reconstruct missing text. Omit a candidate explicitly by excluding it from items when no exact quote supports it. All original evidence and size rules still apply.`

type agendaCorrectionInput struct {
	agendaRollingInput
	Rejected []agendaRejectedSelection `json:"rejectedSelections"`
}

func correctAgendaSection(ctx context.Context, provider Provider, title string, section agendaSection, items []agendaCandidate, failure error) ([]agendaCandidate, error) {
	var missing *agendaMissingQuotesError
	if !errors.As(failure, &missing) {
		return nil, failure
	}
	input, err := json.Marshal(agendaCorrectionInput{agendaRollingInput{title, []agendaSection{section}, items}, missing.Rejected})
	if err != nil {
		return nil, err
	}
	// agendaComplete checks the full serialized prompt and shared call budget.
	// Do not truncate source/state or create another context, worker, or retry.
	raw, err := agendaComplete(ctx, provider, agendaCorrectionSystem, agendaRollingSchema, input)
	if err != nil {
		return nil, err
	}
	return validateRollingAgenda(raw, section, items)
}
