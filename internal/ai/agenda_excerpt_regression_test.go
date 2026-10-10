package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type agendaExcerptRegressionProvider struct{ fakeProvider }

func (p *agendaExcerptRegressionProvider) CompleteJSON(ctx context.Context, request CompletionRequest) (json.RawMessage, error) {
	if strings.Contains(string(request.JSONSchema), `"evidenceIndex"`) {
		p.requests = append(p.requests, request)
		return json.RawMessage(`{"items":[{"topic":"Confirm proposal status?","evidenceIndex":0}]}`), nil
	}
	return p.fakeProvider.CompleteJSON(ctx, request)
}

func TestAgendaCorrectionAvoidsRepeatedQuoteCopyFailure(t *testing.T) {
	section, _ := agendaCorrectionFixture()
	bad := agendaCorrectionResponse(
		agendaCorrectionSelection("we will send the proposal.", -1, 0),
		agendaCorrectionSelection("The API review is already scheduled.", -1, 0),
	)
	p := &agendaExcerptRegressionProvider{fakeProvider{contents: []string{bad, bad}}}
	items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
	if err != nil || len(items) != 1 || len(p.requests) != 2 {
		t.Fatalf("items=%v calls=%d err=%v", items, len(p.requests), err)
	}
	if !strings.Contains(section.Text, items[0].Quote) || items[0].QuoteStart != section.TextStart {
		t.Fatal("correction lost exact source evidence")
	}
}
