package ai

import (
	"context"
	"strings"
	"testing"
)

const observationExtraction = `{"title":"Codex Review","participants":[],"topics":[],"decisions":[{"what":"Continue exploring Codex context limits","who_decided":["Other"],"context":"Codex is limited to 200K tokens","status":"decided","evidence":[{"speaker":"Other","text":"It is still limited to around 200 K"}]}],"action_items":[],"open_questions":[],"sentiment":"neutral"}`

func TestDecisionVerificationDropsObservation(t *testing.T) {
	provider, pipeline := newFakePipeline(observationExtraction,
		`{"verdicts":[{"index":0,"speech_act":"observation","entailed":true}]}`)
	transcript := "[Other] Codex has a large context window.\n[Other] It is still limited to around 200 K.\n[Other] Compaction helps long runs."

	extraction, err := pipeline.Extract(context.Background(), transcript)
	if err != nil {
		t.Fatalf("Extract returned error: %v", err)
	}
	if len(extraction.Decisions) != 0 {
		t.Fatalf("decisions = %#v, want observation dropped", extraction.Decisions)
	}
	assertVerificationWindow(t, provider.requests)
}

func TestDecisionVerificationDropsCandidateWithoutEvidenceWindow(t *testing.T) {
	provider, pipeline := newFakePipeline()
	extraction := &Extraction{Decisions: []Decision{{What: "Ship beta", Status: decisionStatusDecided,
		Evidence: []EvidenceQuote{{Speaker: "Ada", Text: "We will ship beta on Friday"}}}}}

	got, err := pipeline.verifyDecisions(context.Background(), extraction, "[Ada] We discussed launch timing")
	if err != nil || len(got.Decisions) != 0 || len(provider.requests) != 0 {
		t.Fatalf("extraction=%#v requests=%d err=%v, want fail-closed without model call", got, len(provider.requests), err)
	}
}

func TestDecisionVerificationKeepsCommitmentAndCleansLabels(t *testing.T) {
	extracted := `{"title":"Launch Plan","participants":["Other","Ada"],"topics":[],"decisions":[{"what":"Ship beta Friday","who_decided":["Other","Ada"],"context":"Launch timing","status":"decided","evidence":[{"speaker":"Ada","text":"We will ship beta on Friday"}]}],"action_items":[],"open_questions":[],"sentiment":"productive"}`
	_, pipeline := newFakePipeline(extracted,
		`{"verdicts":[{"index":0,"speech_act":"commitment","entailed":true}]}`)

	extraction, err := pipeline.Extract(context.Background(), "[Ada] We will ship beta on Friday")
	if err != nil {
		t.Fatalf("Extract returned error: %v", err)
	}
	if len(extraction.Decisions) != 1 || strings.Join(extraction.Decisions[0].WhoDecided, ",") != "Ada" {
		t.Fatalf("decisions = %#v, want verified Ada commitment", extraction.Decisions)
	}
	if strings.Join(extraction.Participants, ",") != "Ada" {
		t.Fatalf("participants = %#v, want speaker labels removed", extraction.Participants)
	}
}

func assertVerificationWindow(t *testing.T, requests []CompletionRequest) {
	t.Helper()
	if len(requests) != 2 {
		t.Fatalf("request count = %d, want extraction and verification", len(requests))
	}
	request := requests[1]
	if !strings.Contains(request.User, "still limited to around 200 K") {
		t.Fatalf("verification user = %q, want transcript evidence window", request.User)
	}
	if request.Temperature != structuredTemperature || len(request.JSONSchema) == 0 {
		t.Fatalf("verification request = %#v, want structured deterministic request", request)
	}
}
