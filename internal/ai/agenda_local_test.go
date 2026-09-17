package ai

import (
	"encoding/json"
	"os"
	"testing"
)

// Opt-in read-only preflight. The private fixture contains app-selected sources;
// this does not call a model and is not live agenda proof.
func TestAgendaLocalPreflight(t *testing.T) {
	path := os.Getenv("GAPPD_AGENDA_PREFLIGHT_SOURCES")
	if path == "" {
		t.Skip("requires private local sources fixture")
	}
	input := readAgendaPreflightInput(t, path)
	sources, err := prepareAgendaSources(input.Sources)
	if err != nil {
		t.Fatal(err)
	}
	sections, err := agendaSectionsForTitle(input.Title, sources)
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, source := range sources {
		total += len(source.Text)
	}
	t.Logf("sources=%d transcript_bytes=%d sections=%d maximum_requests=%d deadline_minutes=20 provider_calls=0", len(sources), total, len(sections), agendaHistoryCalls(len(sections)))
}

type agendaPreflightInput struct {
	Title   string         `json:"title"`
	Sources []AgendaSource `json:"sources"`
}

func readAgendaPreflightInput(t *testing.T, path string) agendaPreflightInput {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("cannot read local fixture")
	}
	var input agendaPreflightInput
	if json.Unmarshal(raw, &input) != nil {
		t.Fatal("invalid local fixture")
	}

	return input
}
