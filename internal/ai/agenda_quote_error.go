package ai

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

type agendaQuoteFailure string

const (
	agendaAbsentNewQuote  agendaQuoteFailure = "ABSENT_NEW_QUOTE"
	agendaBadQuoteLength  agendaQuoteFailure = "BAD_QUOTE_LENGTH"
	agendaBadQuoteOrdinal agendaQuoteFailure = "BAD_QUOTE_ORDINAL"
	agendaBadQuoteUTF8    agendaQuoteFailure = "BAD_QUOTE_UTF8"
)

type agendaQuoteError struct{ failure agendaQuoteFailure }

func (e *agendaQuoteError) Error() string { return "agenda: " + string(e.failure) }

type agendaRejectedSelection struct {
	Index     int                `json:"index"`
	Failure   agendaQuoteFailure `json:"failure"`
	Selection agendaSelection    `json:"selection"`
}

// Only a complete response with no other defects can produce this error.
type agendaMissingQuotesError struct{ Rejected []agendaRejectedSelection }

func (e *agendaMissingQuotesError) Error() string {
	return fmt.Sprintf("agenda: %s in %d new candidates", agendaAbsentNewQuote, len(e.Rejected))
}

func validateAgendaQuote(quote string, occurrence int) error {
	if occurrence < 0 {
		return &agendaQuoteError{agendaBadQuoteOrdinal}
	}
	if len(strings.TrimSpace(quote)) < 12 || len(quote) > 240 {
		return &agendaQuoteError{agendaBadQuoteLength}
	}
	if !utf8.ValidString(quote) {
		return &agendaQuoteError{agendaBadQuoteUTF8}
	}
	return nil
}

func missingAgendaOccurrence(occurrence, found int) error {
	if occurrence != 0 || found > 0 {
		return &agendaQuoteError{agendaBadQuoteOrdinal}
	}
	return &agendaQuoteError{agendaAbsentNewQuote}
}
