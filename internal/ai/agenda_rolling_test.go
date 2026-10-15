package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

type rollingProbe struct {
	agendaHistoryProvider
	respond func(CompletionRequest) (json.RawMessage, error)
}

func (p *rollingProbe) CompleteJSON(_ context.Context, r CompletionRequest) (json.RawMessage, error) {
	p.record(r)
	return p.respond(r)
}

func TestAgendaRollingPrioritizesInsteadOfOverflowingLedger(t *testing.T) {
	// Distinct verbose ledger entries exceed the old final-context bound.
	sources := []AgendaSource{{ID: "large", StartedAt: "1", Text: strings.Repeat("Discuss the delivery plan. ", 12000)}, {ID: "later", StartedAt: "2", Text: "The delivery plan is now approved."}}
	assertOldAgendaLedgerOverflow(t)
	p := &rollingProbe{respond: rollingResolutionResponse}
	draft, err := GenerateAgenda(context.Background(), p, "Next", sources)
	if err != nil || len(draft.Items) != 0 {
		t.Fatalf("items=%d err=%v", len(draft.Items), err)
	}
	if len(p.requests) > 96 {
		t.Fatal("unbounded calls")
	}
	for _, r := range p.requests {
		if len(r.System)+len(r.User)+len(r.JSONSchema) > agendaRequestBytes {
			t.Fatal("oversized prompt")
		}
	}
	assertAgendaCoverage(t, p.requests, sources[0].Text)
}

func TestAgendaRollingRejectsFabricatedAndJoinedQuotes(t *testing.T) {
	section := agendaSection{AgendaSource: AgendaSource{ID: "x", Text: "First statement here. A gap. Last statement here."}}
	for _, quote := range []string{"First statement here. Last statement here.", "Invented unsupported evidence."} {
		index, occurrence := -1, 0
		raw, _ := json.Marshal(map[string]any{"items": []agendaSelection{{AgendaItem{"Confirm status?", "x", quote}, &index, &occurrence}}})
		p := &fakeProvider{contents: []string{string(raw), string(raw)}}
		if _, err := rollAgendaSection(context.Background(), p, "Next", section, nil); err == nil {
			t.Fatal("accepted unsupported quote")
		}
	}
}

func TestAgendaRollingCorrectsOneAbsentNewQuote(t *testing.T) {
	section := agendaSection{AgendaSource: AgendaSource{ID: "x", Text: "Exact supported statement."}}
	bad := `{"items":[{"topic":"Confirm status?","sourceId":"x","quote":"Absent fabricated statement.","retainedIndex":-1,"quoteOccurrence":0}]}`
	good := `{"items":[{"topic":"Confirm status?","evidenceIndex":0}]}`
	p := &fakeProvider{contents: []string{bad, good}}
	items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
	if err != nil || len(items) != 1 || len(p.requests) != 2 {
		t.Fatalf("items=%d calls=%d err=%v", len(items), len(p.requests), err)
	}
	if !strings.Contains(p.requests[1].System, "case-sensitively") {
		t.Fatal("missing strict correction")
	}
}

func TestAgendaRollingSerializedPreflightAndCancellation(t *testing.T) {
	p := &agendaHistoryProvider{}
	_, err := GenerateAgenda(context.Background(), p, "Next", []AgendaSource{{ID: "x", Text: strings.Repeat("\x00", 200000)}})
	var capacity *AgendaCapacityError
	if !errors.As(err, &capacity) || len(p.requests) != 0 {
		t.Fatal("did not preflight serialized two-pass cost")
	}
	ctx, cancel := context.WithCancel(context.Background())
	probe := &rollingProbe{respond: func(CompletionRequest) (json.RawMessage, error) {
		cancel()
		return json.RawMessage(`{"items":[]}`), nil
	}}
	_, err = GenerateAgenda(ctx, probe, "Next", []AgendaSource{{ID: "x", Text: strings.Repeat("history ", 10000)}})
	if !errors.Is(err, context.Canceled) || len(probe.requests) > agendaConcurrency {
		t.Fatal("cancellation failed")
	}
}

func TestAgendaRollingInvalidOutput(t *testing.T) {
	for _, raw := range []string{`broken`, `{}`, strings.Repeat(" ", 16001), `{"items":[{"topic":"Confirm?","sourceId":"wrong","quote":"First statement here."}]}`} {
		p := &fakeProvider{contents: []string{raw}}
		if _, err := rollAgendaSection(context.Background(), p, "Next", agendaSection{AgendaSource: AgendaSource{ID: "x", Text: "First statement here."}}, nil); err == nil {
			t.Fatal("accepted invalid output")
		}
	}
}

func assertOldAgendaLedgerOverflow(t *testing.T) {
	t.Helper()
	ledger := []AgendaItem{}
	for i := 0; i < 72; i++ {
		ledger = append(ledger, AgendaItem{fmt.Sprint(i) + strings.Repeat("description ", 80), "large", "Discuss the delivery plan."})
	}
	old, _ := agendaInput("Next", ledger)
	if len(old)+len(agendaSystem)+len(agendaSchema) <= agendaRequestBytes {
		t.Fatal("fixture does not overflow old ledger")
	}
}

func rollingResolutionResponse(r CompletionRequest) (json.RawMessage, error) {
	if strings.Contains(r.System, "Reconcile") {
		if strings.Contains(r.User, "now approved") {
			return json.RawMessage(`{"updates":[{"index":0,"resolved":true,"quote":"The delivery plan is now approved.","quoteOccurrence":0}]}`), nil
		}
		return json.RawMessage(`{"updates":[]}`), nil
	}
	var input agendaRollingInput
	json.Unmarshal([]byte(r.User), &input)
	retained := -1
	if len(input.Candidates) > 0 {
		retained = 0
	}
	return json.Marshal(map[string]any{"items": []any{map[string]any{"topic": "Confirm delivery plan status?", "sourceId": "large", "quote": "Discuss the delivery plan.", "retainedIndex": retained, "quoteOccurrence": 0}}})
}
