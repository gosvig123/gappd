package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAgendaParallelConcurrencyAndCleanup(t *testing.T) {
	for _, fail := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		var active, started, peak atomic.Int32
		failure := errors.New("provider unavailable")
		err := parallelAgenda(ctx, 20, func(ctx context.Context, i int) error {
			n := active.Add(1)
			defer active.Add(-1)
			started.Add(1)
			for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
			}
			return finishConcurrentProbe(ctx, i, &started, cancel, fail, failure)
		})
		cancel()
		if active.Load() != 0 || peak.Load() != 4 || started.Load() != 4 {
			t.Fatal("concurrency/scheduling cleanup failed")
		}
		if fail && !errors.Is(err, failure) || !fail && !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	}
}

func TestAgendaParallelResolutionUsesEvidenceOrder(t *testing.T) {
	sources := []AgendaSource{{ID: "candidate", Text: "We will send the proposal."}, {ID: "resolved", Text: "The proposal was cancelled."}, {ID: "reopened", Text: "Explicitly reopen the proposal."}}
	sections := []agendaSection{{AgendaSource: sources[1]}, {AgendaSource: sources[2]}}
	items := []agendaCandidate{{AgendaItem{"Confirm proposal status?", "candidate", sources[0].Text}, 0}}
	var completed atomic.Int32
	p := &rollingProbe{respond: func(r CompletionRequest) (json.RawMessage, error) {
		var input agendaRollingInput
		json.Unmarshal([]byte(r.User), &input)
		section := input.Sources[0]
		if section.ID == "resolved" {
			time.Sleep(30 * time.Millisecond)
		} else {
			completed.Add(1)
		}
		return json.Marshal(map[string]any{"updates": []agendaStatus{agendaTestStatus(0, section.ID == "resolved", section.Text, 0)}})
	}}
	draft, err := reviewAgendaCandidates(context.Background(), p, "Next", sources, sections, items)
	if err != nil || len(draft.Items) != 1 || completed.Load() != 1 {
		t.Fatalf("out-of-order reconciliation err=%v items=%d", err, len(draft.Items))
	}
}

func TestAgendaPairwiseMergeBoundsAndProvenance(t *testing.T) {
	states, sources := agendaMergeFixtures()
	p := &rollingProbe{respond: func(r CompletionRequest) (json.RawMessage, error) {
		if len(r.System)+len(r.User)+len(r.JSONSchema) > agendaRequestBytes {
			t.Fatal("oversized merge")
		}
		var input agendaRollingInput
		json.Unmarshal([]byte(r.User), &input)
		index := len(input.Candidates) - 1
		occurrence := 0
		return json.Marshal(map[string]any{"items": []agendaSelection{{input.Candidates[index].AgendaItem, &index, &occurrence}}})
	}}
	items, err := mergeAgendaPartitions(context.Background(), p, "Next", sources, states)
	if err != nil || len(p.requests) != 3 || len(items) != 1 || items[0] != states[3][7] {
		t.Fatal("merge lost occurrence identity or call bound")
	}
	if preflightAgendaMerge(strings.Repeat("\x00", agendaRequestBytes)) == nil {
		t.Fatal("merge preflight omitted serialized overhead")
	}
}

func TestAgendaParallelCoverageAndGlobalCallAccounting(t *testing.T) {
	sources := []AgendaSource{{ID: "large", Text: strings.Repeat("会議 discussion. ", 14000)}}
	sections, err := agendaSectionsForTitle("Next", sources)
	if err != nil {
		t.Fatal(err)
	}
	p := &agendaHistoryProvider{}
	if _, err = GenerateAgenda(context.Background(), p, "Next", sources); err != nil {
		t.Fatal(err)
	}
	if len(p.requests) != agendaHistoryCalls(len(sections)) || len(p.requests) > agendaMaxCalls {
		t.Fatal("missing merge/request accounting")
	}
	assertAgendaCoverage(t, p.requests, sources[0].Text)
}

func finishConcurrentProbe(ctx context.Context, i int, started *atomic.Int32, cancel context.CancelFunc, fail bool, failure error) error {
	if i == 0 {
		for started.Load() < 4 {
			time.Sleep(time.Millisecond)
		}
		if fail {
			return failure
		}
		cancel()
	}
	<-ctx.Done()
	return ctx.Err()
}

func agendaMergeFixtures() ([][]agendaCandidate, []AgendaSource) {
	states := make([][]agendaCandidate, 4)
	sources := []AgendaSource{}
	for i := range states {
		id := fmt.Sprint(i)
		sources = append(sources, AgendaSource{ID: id})
		for j := 0; j < 8; j++ {
			states[i] = append(states[i], agendaCandidate{AgendaItem{strings.Repeat("topic ", 39), id, strings.Repeat("quote ", 39)}, j * 300})
		}
	}
	return states, sources
}
