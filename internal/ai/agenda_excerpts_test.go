package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestAgendaExcerptsPreserveWordsAndExactPositions(t *testing.T) {
	for _, text := range []string{
		strings.Repeat("A short sentence. ", 100), strings.Repeat("æ🙂", 100),
		strings.Repeat("x", 501), "One supported statement.\nDone.",
		"  First commitment here.\n\nA later resolution here.  ",
	} {
		section := agendaSection{AgendaSource: AgendaSource{ID: "x", Text: text}, TextStart: 17}
		source, evidence := agendaCorrectionEvidence(section, nil)
		var quotes []string
		for _, excerpt := range source.Excerpts {
			quotes = append(quotes, excerpt.Quote)
			if !utf8.ValidString(excerpt.Quote) || len(excerpt.Quote) > agendaExcerptBytes {
				t.Fatal("invalid excerpt boundary")
			}
		}
		if strings.Join(strings.Fields(strings.Join(quotes, "")), "") != strings.Join(strings.Fields(text), "") {
			t.Fatal("source words changed or disappeared")
		}
		assertAgendaExcerptPositions(t, text, evidence)
	}
}

func assertAgendaExcerptPositions(t *testing.T, text string, evidence []agendaCandidate) {
	t.Helper()
	for _, item := range evidence {
		start := item.QuoteStart - 17
		if text[start:start+len(item.Quote)] != item.Quote || len(item.Quote) < 12 {
			t.Fatal("invalid source position or selectable quote")
		}
	}
}

func TestAgendaCorrectionDenseSourceFitsPromptBudget(t *testing.T) {
	section, _ := agendaCorrectionFixture()
	section.Text = strings.Repeat("We will send the proposal. ", 600)
	source, _ := agendaCorrectionEvidence(section, nil)
	bad := agendaCorrectionSelection("we will send the proposal.", -1, 0)
	input, _ := json.Marshal(agendaCorrectionInput{"Next", []agendaExcerptSection{source}, nil, []agendaRejectedSelection{{0, agendaAbsentNewQuote, bad}, {1, agendaAbsentNewQuote, bad}}})
	if len(input)+len(agendaCorrectionSystem)+len(agendaCorrectionSchema) > agendaRequestBytes {
		t.Fatal("excerpt metadata overflowed correction budget")
	}
}

func TestAgendaShortExcerptsRemainResolutionContext(t *testing.T) {
	section := agendaSection{AgendaSource: AgendaSource{ID: "x", Text: "Done."}}
	source, evidence := agendaCorrectionEvidence(section, nil)
	if len(evidence) != 0 || len(source.Excerpts) != 1 || source.Excerpts[0].Index != -1 || source.Excerpts[0].Quote != section.Text {
		t.Fatal("short resolution was selectable or lost")
	}
}
