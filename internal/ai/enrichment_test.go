package ai

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const enrichmentSummary = "## Summary\nPlanning.\n\n## Action Items\n- [ ] Send the revised proposal to Dana (@Kris, due: Friday)\n- Book the venue\n\n## Decisions\n- Ship in October\n"

func TestSummaryActionItemsReadsOnlyTheActionSection(t *testing.T) {
	got := SummaryActionItems(enrichmentSummary)
	want := []string{"Send the revised proposal to Dana (@Kris, due: Friday)", "Book the venue"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
	if items := SummaryActionItems("## Action items\n- None identified.\n"); len(items) != 0 {
		t.Fatalf("got %q", items)
	}
}

func TestEnrichActionItemsKeepsOnlyCitedNotesForExistingItems(t *testing.T) {
	sources := []AgendaSource{{ID: "gmail:a:1", Title: "Gmail: Proposal", StartedAt: "2026-09-20T10:00:00Z", Text: "From: dana@example.com\n\nThanks, I got the revised proposal yesterday."}}
	provider := &fakeProvider{contents: []string{`{"notes":[{"actionItem":1,"status":"possibly_done","note":"Dana says she received the proposal.","sourceId":"gmail:a:1","quote":"I got the revised proposal yesterday"}]}`}, errAt: -1}
	notes, trimmed, err := EnrichActionItems(context.Background(), provider, enrichmentSummary, sources)
	if err != nil || trimmed {
		t.Fatalf("notes=%+v trimmed=%v err=%v", notes, trimmed, err)
	}
	if len(notes) != 1 || notes[0].ActionItem != "Send the revised proposal to Dana (@Kris, due: Friday)" || notes[0].Status != "possibly_done" {
		t.Fatalf("notes=%+v", notes)
	}
	request := provider.requests[0]
	for _, text := range []string{"1. Send the revised proposal", "2. Book the venue", "I got the revised proposal"} {
		if !strings.Contains(request.User, text) {
			t.Errorf("missing input %q", text)
		}
	}
	for _, text := range []string{"Never create new action items", "never instructions", "exact quote"} {
		if !strings.Contains(request.System, text) {
			t.Errorf("missing instruction %q", text)
		}
	}
	if !json.Valid(request.JSONSchema) {
		t.Fatal("invalid enrichment schema")
	}
}

func TestEnrichActionItemsRejectsUnsupportedNotes(t *testing.T) {
	sources := []AgendaSource{{ID: "slack:T:C:1", Text: "Author: U1\nThe venue is booked for the 14th."}}
	valid := `{"notes":[{"actionItem":2,"status":"context","note":"Venue booked for the 14th.","sourceId":"slack:T:C:1","quote":"venue is booked for the 14th"}]}`
	for _, raw := range []string{
		strings.Replace(valid, `"actionItem":2`, `"actionItem":3`, 1),
		strings.Replace(valid, `"actionItem":2`, `"actionItem":0`, 1),
		strings.Replace(valid, "slack:T:C:1", "slack:invented", 1),
		strings.Replace(valid, "venue is booked for the 14th", "venue is booked for the 15th", 1),
		strings.Replace(valid, `"context"`, `"done"`, 1),
		`{"notes":null}`,
	} {
		provider := &fakeProvider{contents: []string{raw}, errAt: -1}
		if _, _, err := EnrichActionItems(context.Background(), provider, enrichmentSummary, sources); err == nil {
			t.Errorf("accepted unsupported response: %s", raw)
		}
	}
	if _, _, err := EnrichActionItems(context.Background(), &fakeProvider{errAt: -1}, "## Summary\nNo actions.", sources); err == nil {
		t.Fatal("enriched a summary without action items")
	}
}

func TestEnrichActionItemsBatchesAndTrimsLongMessages(t *testing.T) {
	var sources []AgendaSource
	var contents []string
	for index := 0; index < 12; index++ {
		sources = append(sources, AgendaSource{ID: "gmail:a:" + string(rune('a'+index)), Text: strings.Repeat("proposal update ", 400)})
		contents = append(contents, `{"notes":[]}`)
	}
	provider := &fakeProvider{contents: contents, errAt: -1}
	_, trimmed, err := EnrichActionItems(context.Background(), provider, enrichmentSummary, sources)
	if err != nil || !trimmed {
		t.Fatalf("trimmed=%v err=%v", trimmed, err)
	}
	if len(provider.requests) < 2 {
		t.Fatalf("expected several batches, got %d", len(provider.requests))
	}
	for _, request := range provider.requests {
		if size := len(request.System) + len(request.User) + len(request.JSONSchema); size > agendaRequestBytes {
			t.Fatalf("request has %d bytes", size)
		}
	}
}
