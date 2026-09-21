package main

import (
	"strings"
	"testing"
)

func TestAgendaCommunicationInput(t *testing.T) {
	raw := `[{"id":"gmail:account:aa","title":"Email","startedAt":"2026-01-01T00:00:00Z","text":"Please confirm the launch review date."},{"id":"slack:team:dm:123","title":"Slack","startedAt":"2026-01-02T00:00:00Z","text":"The launch review was completed."}]`
	sources, err := readAgendaCommunication(strings.NewReader(raw))
	if err != nil || len(sources) != 2 || sources[1].Text != "The launch review was completed." {
		t.Fatalf("sources=%v err=%v", sources, err)
	}
	for _, invalid := range []string{`secret malformed response`, strings.ReplaceAll(raw, "gmail:account:aa", "forged-meeting"), strings.ReplaceAll(raw, "2026-01-01T00:00:00Z", "yesterday"), strings.Repeat("x", 4*maxAgendaSourceBytes+1)} {
		if _, err := readAgendaCommunication(strings.NewReader(invalid)); err == nil {
			t.Fatal("accepted invalid communication input")
		}
	}
}
