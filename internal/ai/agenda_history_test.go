package ai

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"
)

type agendaHistoryProvider struct {
	mu       sync.Mutex
	requests []CompletionRequest
	fail     error
}

func (p *agendaHistoryProvider) Available() error { return nil }
func (p *agendaHistoryProvider) Complete(context.Context, CompletionRequest) (string, error) {
	return "", errors.New("unexpected")
}
func (p *agendaHistoryProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	p.record(req)
	if p.fail != nil {
		return nil, p.fail
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.Contains(req.System, "Reconcile") {
		return json.RawMessage(`{"updates":[]}`), nil
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
	for _, system := range []string{agendaRollingSystem, agendaReviewSystem} {
		sections := []agendaSection{}
		for _, req := range requests {
			if len(req.User)+len(req.System)+len(req.JSONSchema) > agendaRequestBytes || !utf8.ValidString(req.User) {
				t.Fatal("invalid request bounds")
			}
			if req.System != system {
				continue
			}
			var input agendaRollingInput
			if err := json.Unmarshal([]byte(req.User), &input); err != nil {
				t.Fatal(err)
			}
			for _, section := range input.Sources {
				if section.ID == "large" {
					sections = append(sections, section)
				}
			}
		}
		sort.Slice(sections, func(i, j int) bool { return sections[i].TextStart < sections[j].TextStart })
		var covered string
		for _, section := range sections {
			covered = appendAgendaCoverage(t, covered, section.Text)
		}
		if covered != text {
			t.Fatal("skipped source sections")
		}
	}
}

func (p *agendaHistoryProvider) record(req CompletionRequest) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests = append(p.requests, req)
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
		if err == nil || len(p.requests) > agendaConcurrency {
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
