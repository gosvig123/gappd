package ai

import (
	"context"
	"sync"
)

// AgendaCapacityError means local finite processing limits, not provider configuration.
type AgendaCapacityError struct{ Reason string }

func (e *AgendaCapacityError) Error() string {
	return "agenda: " + e.Reason + "; prepare this agenda manually from matched Meetings; no draft was generated"
}

const agendaMaxCalls = 96

type agendaBudgetKey struct{}
type agendaCallBudget struct {
	used int
	mu   sync.Mutex
}

func spendAgendaCall(ctx context.Context) error {
	budget, _ := ctx.Value(agendaBudgetKey{}).(*agendaCallBudget)
	if budget == nil {
		return nil
	}
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if budget.used >= agendaMaxCalls {
		return &AgendaCapacityError{Reason: "96 model-request budget exhausted"}
	}
	budget.used++
	return nil
}
