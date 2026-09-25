package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
)

// Bound model-input content: JSON data, prompts, and schema before transport encoding.
// Provider envelope fields and further JSON escaping are not included.
const agendaRequestBytes = 24000
const MaxAgendaHistoryBytes = 576000

func agendaLimit() error {
	return &AgendaCapacityError{Reason: "history exceeds 44 sources, 576000 evidence bytes, 46 serialized sections, or 24000 model-input content bytes"}
}

func prepareAgendaSources(sources []AgendaSource) ([]AgendaSource, error) {
	total := 0
	seen := map[string]bool{}
	for _, source := range sources {
		total += len(source.Text)
		if len(source.ID) > 200 || len(source.Title) > 1000 || len(source.StartedAt) > 100 {
			return nil, agendaLimit()
		}
		if source.ID == "" || seen[source.ID] {
			return nil, fmt.Errorf("agenda: missing or duplicate source ID")
		}
		seen[source.ID] = true
	}
	if len(sources) == 0 || len(sources) > 44 || total > MaxAgendaHistoryBytes {
		return nil, agendaLimit()
	}
	result := append([]AgendaSource(nil), sources...)
	sort.SliceStable(result, func(i, j int) bool { return result[i].StartedAt < result[j].StartedAt })
	return result, nil
}

func agendaInput(title string, sources any) ([]byte, error) {
	return json.Marshal(struct {
		Title   string `json:"upcomingTitle"`
		Sources any    `json:"sources"`
	}{title, sources})
}

func agendaComplete(ctx context.Context, provider Provider, system, schema string, input []byte) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(input)+len(system)+len(schema) > agendaRequestBytes {
		return nil, agendaLimit()
	}
	if err := spendAgendaCall(ctx); err != nil {
		return nil, err
	}
	raw, err := provider.CompleteJSON(ctx, CompletionRequest{System: system, User: string(input), JSONSchema: json.RawMessage(schema), MaxTokens: 2400, Temperature: 0.1})
	if err != nil {
		return nil, err
	}
	if len(raw) > 16000 {
		return nil, fmt.Errorf("agenda: model output exceeded 16000 bytes; no draft was generated")
	}
	return raw, ctx.Err()
}

// Repeat boundary context without joining nonadjacent transcript text.
func agendaSectionRemainder(text string, cut int) string {
	if cut == len(text) {
		return ""
	}
	return text[runeSafeCut(text, cut-256):]
}
