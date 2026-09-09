package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

type agendaHistoryProvider struct {
	requests []CompletionRequest
	fail     error
}

func (p *agendaHistoryProvider) Available() error { return nil }
func (p *agendaHistoryProvider) Complete(context.Context, CompletionRequest) (string, error) {
	return "", errors.New("unexpected")
}
func (p *agendaHistoryProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	p.requests = append(p.requests, req)
	if p.fail != nil {
		return nil, p.fail
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.Contains(req.System, "Extract") {
		return json.RawMessage(`{"complete":true,"items":[]}`), nil
	}
	return json.RawMessage(`{"items":[]}`), nil
}
func TestAgendaLargeHistoryBoundedCoverage(t *testing.T) {
	text := strings.Repeat("会議 discussion. ", 14000)
	sources := []AgendaSource{{ID: "large", Text: text}, {ID: "later", Text: "The proposal was sent and approved."}}
	p := &agendaHistoryProvider{}
	if _, err := GenerateAgenda(context.Background(), p, "Next", sources); err != nil {
		t.Fatal(err)
	}
	if len(p.requests) < 3 || len(p.requests) > 97 {
		t.Fatalf("requests=%d", len(p.requests))
	}
	assertAgendaCoverage(t, p.requests, text)
}

func assertAgendaCoverage(t *testing.T, requests []CompletionRequest, text string) {
	t.Helper()
	var covered string
	for _, req := range requests[:len(requests)-1] {
		if len(req.User)+len(req.System)+len(req.JSONSchema) > agendaRequestBytes || !utf8.ValidString(req.User) {
			t.Fatal("invalid request budget/UTF-8")
		}
		var input struct {
			Sources []AgendaSource `json:"sources"`
		}
		if err := json.Unmarshal([]byte(req.User), &input); err != nil {
			t.Fatal(err)
		}
		for _, s := range input.Sources {
			if s.ID == "large" {
				covered = appendAgendaCoverage(t, covered, s.Text)
			}
		}
	}
	if !strings.Contains(covered, text) {
		t.Fatal("skipped sections")
	}
}
func TestAgendaHistoryProviderFailureAndCancellation(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		p := &agendaHistoryProvider{fail: errors.New("provider unavailable")}
		if canceled {
			cancel()
			p.fail = nil
		}
		_, err := GenerateAgenda(ctx, p, "Next", []AgendaSource{{ID: "x", Text: strings.Repeat("history ", 30000)}})
		cancel()
		if err == nil || len(p.requests) > 1 {
			t.Fatalf("err=%v calls=%d", err, len(p.requests))
		}
	}
}

func appendAgendaCoverage(t *testing.T, covered, section string) string {
	t.Helper()
	if covered == "" {
		return section
	}
	overlap := len(covered) - runeSafeCut(covered, len(covered)-256)
	if !strings.HasPrefix(section, covered[len(covered)-overlap:]) {
		t.Fatal("section boundary skipped")
	}
	return covered + section[overlap:]
}
