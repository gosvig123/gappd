package ai

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

type agendaCorrectionProbe struct {
	fakeProvider
	observe func(context.Context, int) error
}

func (p *agendaCorrectionProbe) CompleteJSON(ctx context.Context, request CompletionRequest) (json.RawMessage, error) {
	raw, _ := p.fakeProvider.CompleteJSON(ctx, request)
	return raw, p.observe(ctx, len(p.requests))
}

func TestAgendaCorrectionProviderErrorsNeverRetry(t *testing.T) {
	for _, failure := range []error{errors.New("transport failed"), errors.New("authentication unavailable"), errors.New("Codex returned invalid JSON")} {
		for _, failAt := range []int{1, 2} {
			p := &agendaCorrectionProbe{fakeProvider: *agendaCorrectionProvider(), observe: func(_ context.Context, call int) error {
				if call == failAt {
					return failure
				}
				return nil
			}}
			section, _ := agendaCorrectionFixture()
			items, err := rollAgendaSection(context.Background(), p, "Next", section, nil)
			if !errors.Is(err, failure) || items != nil || len(p.requests) != failAt {
				t.Fatalf("calls=%d err=%v", len(p.requests), err)
			}
		}
	}
}

func TestAgendaCorrectionCancellationBeforeAndDuringCalls(t *testing.T) {
	for _, cancelAt := range []int{0, 1, 2} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		p := &agendaCorrectionProbe{fakeProvider: *agendaCorrectionProvider(), observe: func(got context.Context, call int) error {
			if got != ctx {
				t.Fatal("correction changed operation context")
			}
			if call == cancelAt {
				cancel()
			}
			return nil
		}}
		if cancelAt == 0 {
			cancel()
		}
		section, _ := agendaCorrectionFixture()
		items, err := rollAgendaSection(ctx, p, "Next", section, nil)
		cancel()
		if !errors.Is(err, context.Canceled) || items != nil || len(p.requests) != cancelAt {
			t.Fatalf("calls=%d err=%v", len(p.requests), err)
		}
	}
}

func TestAgendaCorrectionExpiredDeadlineDoesNotCallProvider(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	section, _ := agendaCorrectionFixture()
	p := agendaCorrectionProvider()
	items, err := rollAgendaSection(ctx, p, "Next", section, nil)
	if !errors.Is(err, context.DeadlineExceeded) || items != nil || len(p.requests) != 0 {
		t.Fatal("expired operation spent a call")
	}
}

func TestAgendaCorrectionKeepsParallelWorkersAndSharedDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	budget := &agendaCallBudget{used: agendaMaxCalls - 2*agendaConcurrency}
	ctx = context.WithValue(ctx, agendaBudgetKey{}, budget)
	var active, peak, calls atomic.Int32
	ready := make(chan struct{})
	deadline, _ := ctx.Deadline()
	err := parallelAgenda(ctx, agendaConcurrency, func(ctx context.Context, _ int) error {
		p := &agendaCorrectionProbe{fakeProvider: *agendaCorrectionProvider(), observe: func(ctx context.Context, _ int) error {
			got, ok := ctx.Deadline()
			if !ok || got != deadline {
				return errors.New("changed global deadline")
			}
			return observeAgendaCorrectionConcurrency(ctx, &active, &peak, &calls, ready)
		}}
		section, _ := agendaCorrectionFixture()
		_, err := rollAgendaSection(ctx, p, "Next", section, nil)
		return err
	})
	if err != nil || peak.Load() != agendaConcurrency || active.Load() != 0 || calls.Load() != 2*agendaConcurrency || budget.used != agendaMaxCalls {
		t.Fatalf("peak=%d active=%d calls=%d budget=%d err=%v", peak.Load(), active.Load(), calls.Load(), budget.used, err)
	}
}

func observeAgendaCorrectionConcurrency(ctx context.Context, active, peak, calls *atomic.Int32, ready chan struct{}) error {
	current := active.Add(1)
	defer active.Add(-1)
	for old := peak.Load(); current > old && !peak.CompareAndSwap(old, current); old = peak.Load() {
	}
	call := calls.Add(1)
	if call == agendaConcurrency {
		close(ready)
	}
	if call <= agendaConcurrency {
		select {
		case <-ready:
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
			return errors.New("workers did not start")
		}
	}
	return nil
}
