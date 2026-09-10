package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestAgendaDenseLedgerBudget(t *testing.T) {
	p := &agendaProbe{respond: verboseDenseResponse}
	draft, err := GenerateAgenda(context.Background(), p, "Delivery", denseSources())
	var capacity *AgendaCapacityError
	if !errors.As(err, &capacity) || !strings.Contains(capacity.Reason, "ledger") || len(draft.Items) != 0 {
		t.Fatalf("draft=%v err=%v", draft, err)
	}
	if !strings.Contains(p.requests[len(p.requests)-1].System, "Extract") {
		t.Fatal("synthesized partial ledger")
	}
}

func TestAgendaDenseProviderFailure(t *testing.T) {
	failure := errors.New("invalid credentials")
	p := &agendaProbe{respond: func(CompletionRequest) (json.RawMessage, error) { return nil, failure }}
	_, err := generateAgendaHistory(context.Background(), p, "Delivery", denseSources())
	if !errors.Is(err, failure) || len(p.requests) != 1 {
		t.Fatalf("err=%v requests=%d", err, len(p.requests))
	}
}

func verboseDenseResponse(r CompletionRequest) (json.RawMessage, error) {
	raw, err := denseResponse(r)
	var response struct {
		Complete bool         `json:"complete"`
		Items    []AgendaItem `json:"items"`
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(raw, &response); err != nil {
		return nil, err
	}
	for i := range response.Items {
		response.Items[i].Topic = strings.Repeat("description ", 80)
	}
	return json.Marshal(response)
}

func TestAgendaGlobalAdaptiveBudget(t *testing.T) {
	p := &agendaProbe{respond: func(r CompletionRequest) (json.RawMessage, error) {
		var input struct {
			Sources []AgendaSource `json:"sources"`
		}
		if err := json.Unmarshal([]byte(r.User), &input); err != nil {
			return nil, err
		}
		complete := len(input.Sources[0].Text) <= 80
		return json.Marshal(struct {
			Complete bool         `json:"complete"`
			Items    []AgendaItem `json:"items"`
		}{complete, []AgendaItem{}})
	}}
	draft, err := GenerateAgenda(context.Background(), p, "Next", denseSources())
	var capacity *AgendaCapacityError
	if !errors.As(err, &capacity) || len(p.requests) != 96 || len(draft.Items) != 0 {
		t.Fatalf("err=%v calls=%d draft=%v", err, len(p.requests), draft)
	}
}
