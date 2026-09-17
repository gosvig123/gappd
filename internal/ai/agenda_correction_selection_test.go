package ai

import (
	"strings"
	"testing"
)

func agendaExcerptResponse() string {
	return `{"items":[{"topic":"Confirm status?","evidenceIndex":0}]}`
}

func agendaExcerptResponseForCount(count int) string {
	if count == 0 {
		return `{"items":[]}`
	}
	return agendaExcerptResponse()
}

func TestAgendaCorrectionRejectsInvalidExcerptSelections(t *testing.T) {
	section, _ := agendaCorrectionFixture()
	_, evidence := agendaCorrectionEvidence(section, nil)
	for _, entry := range []string{
		`null`, `{}`, `{"topic":"Confirm?","evidenceIndex":null}`,
		`{"topic":null,"evidenceIndex":0}`, `{"topic":"","evidenceIndex":0}`,
		`{"topic":"Confirm?","evidenceIndex":-1}`, `{"topic":"Confirm?","evidenceIndex":2}`,
		`{"topic":"Confirm?","evidenceIndex":0.5}`, `{"topic":"Confirm?","evidenceIndex":"0"}`,
		`{"topic":"Confirm?","evidenceIndex":0,"evidenceIndex":1}`,
		`{"Topic":"Confirm?","evidenceIndex":0}`, `{"topic":"Confirm?","evidenceIndex":0,"quote":"invented"}`,
		`{"topic":"\ud800","evidenceIndex":0}`,
	} {
		if items, err := validateAgendaCorrection([]byte(`{"items":[`+entry+`]}`), evidence); err == nil || items != nil {
			t.Fatalf("accepted invalid selection: %s", entry)
		}
	}
}

func TestAgendaCorrectionExactRepeatedUnicodeEvidence(t *testing.T) {
	text := strings.Repeat("Vi aftaler næste møde. ", 30)
	section := agendaSection{AgendaSource: AgendaSource{ID: "x", Text: text}, TextStart: 23}
	_, evidence := agendaCorrectionEvidence(section, nil)
	items, err := validateAgendaCorrection([]byte(`{"items":[{"topic":"Confirm?","evidenceIndex":1}]}`), evidence)
	if err != nil || len(items) != 1 || items[0].QuoteStart != evidence[1].QuoteStart || items[0].QuoteStart <= 23 || text[items[0].QuoteStart-23:items[0].QuoteStart-23+len(items[0].Quote)] != items[0].Quote {
		t.Fatalf("lost repeated Unicode provenance: %v %v", items, err)
	}
}

func TestAgendaCorrectionRejectsOversizedState(t *testing.T) {
	evidence := []agendaCandidate{{AgendaItem{"", "x", strings.Repeat("\x00", 240)}, 0}}
	entry := `{"topic":"Confirm?","evidenceIndex":0}`
	raw := `{"items":[` + strings.TrimSuffix(strings.Repeat(entry+",", 8), ",") + `]}`
	if items, err := validateAgendaCorrection([]byte(raw), evidence); err == nil || items != nil {
		t.Fatal("correction bypassed serialized state budget")
	}
}
