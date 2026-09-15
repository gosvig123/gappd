package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func agendaCorrectionProvider() *fakeProvider {
	return &fakeProvider{contents: []string{agendaCorrectionResponse(agendaCorrectionSelection("we will send the proposal.", -1, 0)), agendaExcerptResponse()}}
}

func TestAgendaCorrectionSharesGlobalCallBudget(t *testing.T) {
	for _, remaining := range []int{0, 1, 2} {
		budget := &agendaCallBudget{used: agendaMaxCalls - remaining}
		ctx := context.WithValue(context.Background(), agendaBudgetKey{}, budget)
		section, _ := agendaCorrectionFixture()
		p := agendaCorrectionProvider()
		items, err := rollAgendaSection(ctx, p, "Next", section, nil)
		var capacity *AgendaCapacityError
		if len(p.requests) != remaining || budget.used != agendaMaxCalls {
			t.Fatal("correction escaped shared budget")
		}
		if remaining < 2 && (!errors.As(err, &capacity) || items != nil) {
			t.Fatalf("expected capacity failure, got %v", err)
		}
		if remaining == 2 && (err != nil || len(items) != 1) {
			t.Fatalf("last budgeted correction failed: %v", err)
		}
	}
}

func agendaCorrectionSizedSection(t *testing.T, target int, correction bool) agendaSection {
	t.Helper()
	section, _ := agendaCorrectionFixture()
	input := rollingAgendaInput("Next", section, nil)
	system := agendaRollingSystem
	if correction {
		bad := agendaCorrectionSelection("we will send the proposal.", -1, 0)
		source, _ := agendaCorrectionEvidence(section, nil)
		input, _ = json.Marshal(agendaCorrectionInput{"Next", []agendaExcerptSection{source}, nil, []agendaRejectedSelection{{0, agendaAbsentNewQuote, bad}}})
		system = agendaCorrectionSystem
	}
	schema := agendaRollingSchema
	if correction {
		schema = agendaCorrectionSchema
	}
	padding := target - len(input) - len(system) - len(schema)
	if padding < 0 {
		t.Fatal("invalid fixture bound")
	}
	// Metadata padding does not add excerpts or change their serialized overhead.
	section.Title += strings.Repeat("x", padding)
	return section
}

type agendaCorrectionBoundCase struct {
	name         string
	correction   bool
	extra, calls int
	succeeds     bool
}

func TestAgendaCorrectionPromptBounds(t *testing.T) {
	cases := []agendaCorrectionBoundCase{
		{"original oversized", false, 1, 0, false},
		{"correction cannot fit", false, 0, 1, false},
		{"correction exact bound", true, 0, 2, true},
		{"correction one byte over", true, 1, 1, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			section := agendaCorrectionSizedSection(t, agendaRequestBytes+test.extra, test.correction)
			p := agendaCorrectionProvider()
			items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
			var capacity *AgendaCapacityError
			if len(p.requests) != test.calls || test.succeeds != (err == nil) {
				t.Fatalf("calls=%d err=%v", len(p.requests), err)
			}
			if !test.succeeds && (!errors.As(err, &capacity) || items != nil) {
				t.Fatal("expected no partial result on capacity failure")
			}
			assertAgendaCorrectionRequestBounds(t, p.requests)
		})
	}
}

func assertAgendaCorrectionRequestBounds(t *testing.T, requests []CompletionRequest) {
	t.Helper()
	for _, request := range requests {
		if len(request.User)+len(request.System)+len(request.JSONSchema) > agendaRequestBytes {
			t.Fatal("oversized request")
		}
	}
}

func TestAgendaCorrectionSerializedStateBudgetNeverRetries(t *testing.T) {
	bad := agendaCorrectionSelection("we will send the proposal.", -1, 0)
	large := agendaCorrectionSelection(strings.Repeat("\x00", 240), -1, 0)
	large.Topic = strings.Repeat("\x00", 240)
	raw := agendaCorrectionResponse(bad, large, large, large)
	section, _ := agendaCorrectionFixture()
	section.Text += large.Quote
	p := &fakeProvider{contents: []string{raw, `{"items":[]}`}}
	items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
	var capacity *AgendaCapacityError
	if !errors.As(err, &capacity) || items != nil || len(p.requests) != 1 {
		t.Fatalf("calls=%d err=%v", len(p.requests), err)
	}
}

func TestAgendaCorrectionOutputBudgetNeverRetries(t *testing.T) {
	for _, corrected := range []bool{false, true} {
		p := agendaCorrectionProvider()
		index := 0
		if corrected {
			index = 1
		}
		p.contents[index] = strings.Repeat(" ", 16001)
		section, _ := agendaCorrectionFixture()
		items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
		if err == nil || items != nil || len(p.requests) != index+1 {
			t.Fatal("output budget did not fail closed")
		}
	}
}
