package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
)

// Opt-in product-provider proof on an isolated DB. Meeting IDs and title must
// come from the actual app event-selection path, not invented attendee inputs.
func TestAgendaLocalProvider(t *testing.T) {
	path := os.Getenv("GAPPD_AGENDA_LOCAL_INPUT")
	if path == "" {
		t.Skip("requires captured event selection and copied DB")
	}
	input := readLocalAgendaInput(t, path)
	cfg, err := config.Load()
	if err != nil || cfg.AI.Provider != config.ProviderCodexExec {
		t.Fatal("configured Installed Codex provider required")
	}
	isolated := isolatedAgendaDB(t, cfg.DBPath, input.DBPath)
	cfg.DBPath = isolated
	store, err := openDB(cfg)
	if err != nil {
		t.Fatal("cannot open isolated DB")
	}
	defer store.Close()
	sources, err := agendaSources(store, input.MeetingIDs)
	if err != nil {
		t.Fatal(err)
	}
	runLocalAgendaProvider(t, cfg.AI, input.Title, sources)
}

type localAgendaInput struct {
	Title      string   `json:"title"`
	MeetingIDs []string `json:"meetingIds"`
	DBPath     string   `json:"dbPath"`
}

func readLocalAgendaInput(t *testing.T, path string) localAgendaInput {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("cannot read private event selection")
	}
	var input localAgendaInput
	if json.Unmarshal(raw, &input) != nil || len(input.MeetingIDs) == 0 || input.Title == "" {
		t.Fatal("invalid private event selection")
	}
	return input
}

type localAgendaProvider struct {
	mu sync.Mutex
	ai.Provider
	calls, maxInput int
}

func (p *localAgendaProvider) CompleteJSON(ctx context.Context, request ai.CompletionRequest) (json.RawMessage, error) {
	p.mu.Lock()
	p.calls++
	p.maxInput = max(p.maxInput, len(request.System)+len(request.User)+len(request.JSONSchema))
	p.mu.Unlock()
	return p.Provider.CompleteJSON(ctx, request)
}

func runLocalAgendaProvider(t *testing.T, settings config.AI, title string, sources []ai.AgendaSource) {
	t.Helper()
	provider, err := newAIProvider(settings)
	if err != nil {
		t.Fatal("configured provider initialization failed")
	}
	probe := &localAgendaProvider{Provider: provider}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	start := time.Now()
	draft, err := ai.GenerateAgenda(ctx, probe, title, sources)
	model := settings.CodexModel
	if model == "" {
		model = "provider default; effective model unknown"
	}
	t.Logf("sources=%d requests=%d max_input_bytes=%d elapsed_seconds=%.1f model=%s items=%d error=%t", len(sources), probe.calls, probe.maxInput, time.Since(start).Seconds(), model, len(draft.Items), err != nil)
	if err != nil {
		t.Fatal("local provider agenda failed; no fixed claim (private provider errors not logged)")
	}
	t.Logf("valid_item_source_quote_pairs=%d", len(draft.Items))
}

func isolatedAgendaDB(t *testing.T, original, path string) string {
	t.Helper()
	originalInfo, err := os.Stat(original)
	if err != nil {
		t.Fatal("cannot identify original DB")
	}
	isolatedInfo, err := os.Stat(path)
	if err != nil || os.SameFile(originalInfo, isolatedInfo) {
		t.Fatal("isolated copied DB required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		t.Fatal("invalid isolated DB path")
	}
	return absolute
}
