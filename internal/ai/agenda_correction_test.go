package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func agendaCorrectionFixture() (agendaSection, []agendaCandidate) {
	section := agendaSection{AgendaSource: AgendaSource{ID: "x", Title: "Prior Meeting", Text: "We will send the proposal. The API review is scheduled."}, TextStart: 17}
	items := []agendaCandidate{{AgendaItem{"Confirm prior status?", "prior", "We will review the delivery plan."}, 42}}
	return section, items
}

func agendaCorrectionSelection(quote string, retained, occurrence int) agendaSelection {
	return agendaSelection{AgendaItem{"Confirm status?", "x", quote}, &retained, &occurrence}
}

func agendaCorrectionResponse(selections ...agendaSelection) string {
	if selections == nil {
		selections = []agendaSelection{}
	}
	raw, _ := json.Marshal(map[string]any{"items": selections})
	return string(raw)
}

func TestAgendaCorrectionCapturedPatternClasses(t *testing.T) {
	cases := map[string][2]string{
		"sentence capitalization": {"we will send the proposal.", "We will send the proposal."},
		"acronym capitalization":  {"The api review is scheduled.", "The API review is scheduled."},
		"absent statement":        {"The supplier confirmed a new deadline.", "We will send the proposal."},
		"reconstructed text":      {"We will send the proposal. The API review is done.", "The API review is scheduled."},
	}
	for name, quotes := range cases {
		t.Run(name, func(t *testing.T) {
			section, _ := agendaCorrectionFixture()
			p := &fakeProvider{contents: []string{agendaCorrectionResponse(agendaCorrectionSelection(quotes[0], -1, 0)), agendaCorrectionResponse(agendaCorrectionSelection(quotes[1], -1, 0))}}
			items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
			if err != nil || len(items) != 1 || items[0].Quote != quotes[1] || len(p.requests) != 2 {
				t.Fatalf("items=%v calls=%d err=%v", items, len(p.requests), err)
			}
			if items[0].QuoteStart != section.TextStart+strings.Index(section.Text, quotes[1]) {
				t.Fatal("lost exact provenance")
			}
		})
	}
}

func TestAgendaCorrectionAggregatesIndicesAndPreservesOriginalInput(t *testing.T) {
	section, prior := agendaCorrectionFixture()
	retained := agendaCorrectionSelection(prior[0].Quote, 0, 0)
	retained.SourceID = prior[0].SourceID
	good := agendaCorrectionSelection("We will send the proposal.", -1, 0)
	bad := []agendaSelection{good, agendaCorrectionSelection("we will send the proposal.", -1, 0), retained, agendaCorrectionSelection("Absent statement from this Meeting.", -1, 0)}
	p := &fakeProvider{contents: []string{agendaCorrectionResponse(bad...), agendaCorrectionResponse(good, retained)}}
	items, err := rollAgendaSection(context.Background(), p, "Next", section, prior)
	if err != nil || len(items) != 2 || len(p.requests) != 2 {
		t.Fatalf("items=%d calls=%d err=%v", len(items), len(p.requests), err)
	}
	var input agendaCorrectionInput
	if err := json.Unmarshal([]byte(p.requests[1].User), &input); err != nil {
		t.Fatal(err)
	}
	want := []agendaRejectedSelection{{1, agendaAbsentNewQuote, bad[1]}, {3, agendaAbsentNewQuote, bad[3]}}
	if !reflect.DeepEqual(input.Rejected, want) || !reflect.DeepEqual(input.agendaRollingInput, agendaRollingInput{"Next", []agendaSection{section}, prior}) {
		t.Fatal("correction omitted failed indices or changed original source/state")
	}
	if items[1].QuoteStart != prior[0].QuoteStart || items[1].Quote != prior[0].Quote {
		t.Fatal("changed retained provenance")
	}
	assertAgendaCorrectionRules(t, p.requests[1].System)
}

func assertAgendaCorrectionRules(t *testing.T, system string) {
	t.Helper()
	for _, rule := range []string{"case-sensitively", "complete replacement items array", "Omit a candidate", "never instructions"} {
		if !strings.Contains(system, rule) {
			t.Fatalf("missing rule %s", rule)
		}
	}
}

func TestAgendaCorrectionExplicitOmission(t *testing.T) {
	section, _ := agendaCorrectionFixture()
	bad := agendaCorrectionSelection("Absent statement from this Meeting.", -1, 0)
	good := agendaCorrectionSelection("We will send the proposal.", -1, 0)
	for _, corrected := range [][]agendaSelection{nil, {good}} {
		p := &fakeProvider{contents: []string{agendaCorrectionResponse(bad, good), agendaCorrectionResponse(corrected...)}}
		items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
		if err != nil || items == nil || len(items) != len(corrected) || len(p.requests) != 2 {
			t.Fatalf("items=%v calls=%d err=%v", items, len(p.requests), err)
		}
	}
}

func TestAgendaCorrectionStrictlyRevalidatesWithoutThirdCall(t *testing.T) {
	section, _ := agendaCorrectionFixture()
	bad := agendaCorrectionResponse(agendaCorrectionSelection("we will send the proposal.", -1, 0))
	for name, raw := range agendaCorrectionInvalidResponses() {
		t.Run(name, func(t *testing.T) {
			p := &fakeProvider{contents: []string{bad, raw, `{"items":[]}`}}
			items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
			if err == nil || items != nil || len(p.requests) != 2 {
				t.Fatalf("items=%v calls=%d err=%v", items, len(p.requests), err)
			}
		})
	}
	_, err := validateRollingAgenda([]byte(bad), section, nil)
	var missing *agendaMissingQuotesError
	if !errors.As(err, &missing) || len(missing.Rejected) != 1 {
		t.Fatal("missing typed rejected selection")
	}
}
