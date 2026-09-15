package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func agendaCorrectionInvalidSelections() map[string]string {
	good := agendaCorrectionResponse(agendaCorrectionSelection("We will send the proposal.", -1, 0))
	entry := strings.TrimSuffix(strings.TrimPrefix(good, `{"items":[`), `]}`)
	return map[string]string{
		"source":                 strings.Replace(entry, `"x"`, `"wrong"`, 1),
		"retained index":         strings.Replace(entry, `"retainedIndex":-1`, `"retainedIndex":8`, 1),
		"retained quote":         strings.Replace(strings.Replace(entry, `"retainedIndex":-1`, `"retainedIndex":0`, 1), `"x"`, `"prior"`, 1),
		"retained source":        strings.Replace(strings.Replace(entry, `We will send the proposal.`, `We will review the delivery plan.`, 1), `"retainedIndex":-1`, `"retainedIndex":0`, 1),
		"negative index":         strings.Replace(entry, `"retainedIndex":-1`, `"retainedIndex":-2`, 1),
		"null index":             strings.Replace(entry, `"retainedIndex":-1`, `"retainedIndex":null`, 1),
		"negative occurrence":    strings.Replace(entry, `"quoteOccurrence":0`, `"quoteOccurrence":-1`, 1),
		"unavailable occurrence": strings.Replace(entry, `"quoteOccurrence":0`, `"quoteOccurrence":1`, 1),
		"absent ordinal":         strings.ReplaceAll(strings.Replace(entry, `"quoteOccurrence":0`, `"quoteOccurrence":1`, 1), "We will", "They will"),
		"null occurrence":        strings.Replace(entry, `"quoteOccurrence":0`, `"quoteOccurrence":null`, 1),
		"short quote":            strings.Replace(entry, "We will send the proposal.", "Short", 1),
		"long quote":             strings.Replace(entry, "We will send the proposal.", strings.Repeat("q", 241), 1),
		"empty topic":            strings.Replace(entry, "Confirm status?", " ", 1),
		"long topic":             strings.Replace(entry, "Confirm status?", strings.Repeat("t", 241), 1),
	}
}

func agendaCorrectionMalformedSelections() map[string]string {
	return map[string]string{
		"missing fields":        `{"topic":"Confirm?","sourceId":"x","quote":"Absent valid-length quote."}`,
		"wrong type":            `{"topic":"Confirm?","sourceId":9,"quote":"Absent valid-length quote.","retainedIndex":-1,"quoteOccurrence":0}`,
		"null string":           `{"topic":null,"sourceId":"x","quote":"Absent valid-length quote.","retainedIndex":-1,"quoteOccurrence":0}`,
		"null candidate":        `null`,
		"unknown field":         `{"topic":"Confirm?","sourceId":"x","quote":"Absent valid-length quote.","retainedIndex":-1,"quoteOccurrence":0,"extra":1}`,
		"duplicate field":       `{"topic":"Confirm?","sourceId":"x","quote":"We will send the proposal.","quote":"Absent valid-length quote.","retainedIndex":-1,"quoteOccurrence":0}`,
		"wrong key case":        `{"Topic":"Confirm?","sourceId":"x","quote":"Absent valid-length quote.","retainedIndex":-1,"quoteOccurrence":0}`,
		"fractional occurrence": `{"topic":"Confirm?","sourceId":"x","quote":"Absent valid-length quote.","retainedIndex":-1,"quoteOccurrence":0.5}`,
		"invalid UTF8":          "{\"topic\":\"Confirm?\",\"sourceId\":\"x\",\"quote\":\"Absent invalid \xff quote.\",\"retainedIndex\":-1,\"quoteOccurrence\":0}",
		"unpaired UTF16":        `{"topic":"Confirm?","sourceId":"x","quote":"Absent invalid \ud800 quote.","retainedIndex":-1,"quoteOccurrence":0}`,
	}
}

func agendaCorrectionInvalidResponses() map[string]string {
	responses := map[string]string{"malformed JSON": `broken`, "missing items": `{}`, "null items": `{"items":null}`, "wrong root": `[]`, "unknown root field": `{"items":[],"extra":0}`, "duplicate items": `{"items":[],"items":[]}`}
	for name, entry := range agendaCorrectionInvalidSelections() {
		responses[name] = `{"items":[` + entry + `]}`
	}
	for name, entry := range agendaCorrectionMalformedSelections() {
		responses[name] = `{"items":[` + entry + `]}`
	}
	responses["still absent"] = agendaCorrectionResponse(agendaCorrectionSelection("we will send the proposal.", -1, 0))
	responses["trailing JSON"] = responses["still absent"] + `{}`
	responses["too many"] = `{"items":[` + strings.TrimSuffix(strings.Repeat(`{"topic":"Confirm?","sourceId":"x","quote":"Absent valid-length quote.","retainedIndex":-1,"quoteOccurrence":0},`, 9), ",") + `]}`
	return responses
}

func TestAgendaCorrectionMixedDefectsNeverRetryInEitherOrder(t *testing.T) {
	defects := agendaCorrectionInvalidSelections()
	for name, entry := range agendaCorrectionMalformedSelections() {
		defects[name] = entry
	}
	bad := agendaCorrectionResponse(agendaCorrectionSelection("we will send the proposal.", -1, 0))
	absent := strings.TrimSuffix(strings.TrimPrefix(bad, `{"items":[`), `]}`)
	for name, entry := range defects {
		t.Run(name, func(t *testing.T) {
			for _, pair := range []string{absent + "," + entry, entry + "," + absent} {
				assertAgendaCorrectionNoRetry(t, `{"items":[`+pair+`]}`)
			}
		})
	}
}

func assertAgendaCorrectionNoRetry(t *testing.T, raw string) {
	t.Helper()
	section, prior := agendaCorrectionFixture()
	p := &fakeProvider{contents: []string{raw, `{"items":[]}`}}
	items, err := rollAgendaSection(context.Background(), p, "Next", section, prior)
	if err == nil || items != nil || len(p.requests) != 1 {
		t.Fatalf("items=%v calls=%d err=%v", items, len(p.requests), err)
	}
}

func TestAgendaCorrectionMalformedWholeResponseNeverRetries(t *testing.T) {
	for name, raw := range agendaCorrectionInvalidResponses() {
		if name == "still absent" {
			continue
		}
		t.Run(name, func(t *testing.T) { assertAgendaCorrectionNoRetry(t, raw) })
	}
}

func TestAgendaCorrectionRejectsInvalidSourceUTF8(t *testing.T) {
	section, _ := agendaCorrectionFixture()
	section.Text += "\xff"
	p := &fakeProvider{contents: []string{agendaCorrectionResponse(agendaCorrectionSelection("Absent valid-length quote.", -1, 0)), `{"items":[]}`}}
	if _, err := rollAgendaSection(context.Background(), p, "Next", section, nil); err == nil || len(p.requests) != 1 {
		t.Fatal("retried invalid UTF8 source")
	}
}

func TestAgendaCorrectionJSONPreservesExactUnicode(t *testing.T) {
	for _, quote := range []string{"Exact statement \ufffd end.", "Exact statement 🙂 end.", `Exact statement \ud800 end.`} {
		section := agendaSection{AgendaSource: AgendaSource{ID: "x", Text: quote}}
		raw := agendaCorrectionResponse(agendaCorrectionSelection(quote, -1, 0))
		raw = strings.ReplaceAll(raw, "🙂", `\ud83d\ude42`)
		items, err := validateRollingAgenda(json.RawMessage(raw), section, nil)
		if err != nil || len(items) != 1 || items[0].Quote != quote {
			t.Fatalf("exact Unicode rejected: %v", err)
		}
	}
}
