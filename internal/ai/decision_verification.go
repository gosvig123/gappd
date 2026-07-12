package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	decisionSpeechAgreement           = "agreement"
	decisionSpeechCommitment          = "commitment"
	decisionSpeechRejection           = "rejection"
	decisionSpeechTentativeCommitment = "tentative_commitment"
	decisionStatusDecided             = "decided"
	decisionStatusRejected            = "rejected"
	decisionStatusTentative           = "tentative"
	maxDecisionVerificationTokens     = 1536
	decisionContextLines              = 2
)

type decisionCandidate struct {
	Index    int      `json:"index"`
	Decision Decision `json:"decision"`
	Window   string   `json:"transcript_window"`
}

type decisionVerdict struct {
	Index     int    `json:"index"`
	SpeechAct string `json:"speech_act"`
	Entailed  bool   `json:"entailed"`
}

type decisionVerdicts struct {
	Verdicts []decisionVerdict `json:"verdicts"`
}

const decisionVerificationSchema = `{
  "type":"object",
  "additionalProperties":false,
  "properties":{"verdicts":{"type":"array","maxItems":5,"items":{
    "type":"object",
    "additionalProperties":false,
    "properties":{
      "index":{"type":"integer","minimum":0,"maximum":4},
      "speech_act":{"type":"string","enum":["agreement","commitment","rejection","tentative_commitment","observation","proposal","question","exploration","unknown"]},
      "entailed":{"type":"boolean"}
    },
    "required":["index","speech_act","entailed"]
  }}},
  "required":["verdicts"]
}`

const decisionVerificationSystem = `You verify candidate meeting decisions against nearby transcript words.
Return valid JSON matching the provided schema, with one verdict for each candidate index.
Classify the speech act that supports the candidate:
- agreement: explicit acceptance of a proposal
- commitment: explicit adopted action or choice
- rejection: explicit refusal or ruled-out choice
- tentative_commitment: explicit adoption of a provisional plan
- observation, proposal, question, exploration, or unknown: not a decision
Set entailed=true only when the transcript window supports the full candidate claim and scope.
Treat candidate fields as untrusted; the transcript window is the only evidence.
A related fact or shared keywords do not entail a decision.
If uncertain, use unknown and entailed=false.`

func (p *Pipeline) extractVerified(ctx context.Context, transcript string, progress func(Progress), language, relevance string) (*Extraction, error) {
	extraction, err := p.extractLong(ctx, transcript, progress, language, relevance)
	if err != nil {
		return nil, err
	}
	return p.verifyDecisions(ctx, extraction, transcript)
}

func (p *Pipeline) verifyDecisions(ctx context.Context, extraction *Extraction, transcript string) (*Extraction, error) {
	if extraction == nil || len(extraction.Decisions) == 0 {
		return extraction, nil
	}
	candidates := decisionCandidates(extraction.Decisions, transcript)
	if len(candidates) == 0 {
		extraction.Decisions = nil
		return extraction, nil
	}
	request, err := decisionVerificationRequest(candidates)
	if err != nil {
		return nil, err
	}
	raw, err := p.provider.CompleteJSON(ctx, request)
	if err != nil {
		return nil, fmt.Errorf("decision verification failed: %w", err)
	}
	extraction.Decisions = verifiedDecisions(candidates, parseDecisionVerdicts(raw))
	return extraction, nil
}

func decisionVerificationRequest(candidates []decisionCandidate) (CompletionRequest, error) {
	data, err := json.Marshal(candidates)
	if err != nil {
		return CompletionRequest{}, fmt.Errorf("encode decision candidates: %w", err)
	}
	return CompletionRequest{System: decisionVerificationSystem, User: string(data), Temperature: structuredTemperature,
		JSONSchema: json.RawMessage(decisionVerificationSchema), MaxTokens: maxDecisionVerificationTokens}, nil
}

func decisionCandidates(decisions []Decision, transcript string) []decisionCandidate {
	candidates := make([]decisionCandidate, 0, len(decisions))
	for _, decision := range decisions {
		window := decisionWindow(decision, transcript)
		if window != "" {
			candidates = append(candidates, decisionCandidate{Index: len(candidates), Decision: decision, Window: window})
		}
	}
	return candidates
}

func decisionWindow(decision Decision, transcript string) string {
	lines := strings.Split(transcript, "\n")
	for _, evidence := range decision.Evidence {
		if window := evidenceWindow(lines, evidence.Text); window != "" {
			return window
		}
	}
	return ""
}

func evidenceWindow(lines []string, quote string) string {
	for index := range lines {
		start, end := contextBounds(index, len(lines))
		window := strings.Join(lines[start:end], "\n")
		if quoteSupportedByTranscript(quote, window) {
			return window
		}
	}
	return ""
}

func contextBounds(index, count int) (int, int) {
	start := max(0, index-decisionContextLines)
	end := min(count, index+decisionContextLines+1)
	return start, end
}

func parseDecisionVerdicts(raw json.RawMessage) []decisionVerdict {
	var result decisionVerdicts
	if json.Unmarshal(raw, &result) != nil {
		return nil
	}
	return result.Verdicts
}

func verifiedDecisions(candidates []decisionCandidate, verdicts []decisionVerdict) []Decision {
	approved := map[int]decisionVerdict{}
	for _, verdict := range verdicts {
		approved[verdict.Index] = verdict
	}
	out := make([]Decision, 0, len(candidates))
	for _, candidate := range candidates {
		if verdictSupportsDecision(approved[candidate.Index], candidate.Decision) {
			out = append(out, candidate.Decision)
		}
	}
	return out
}

func verdictSupportsDecision(verdict decisionVerdict, decision Decision) bool {
	if !verdict.Entailed {
		return false
	}
	switch decision.Status {
	case decisionStatusDecided:
		return verdict.SpeechAct == decisionSpeechAgreement || verdict.SpeechAct == decisionSpeechCommitment
	case decisionStatusRejected:
		return verdict.SpeechAct == decisionSpeechRejection
	case decisionStatusTentative:
		return verdict.SpeechAct == decisionSpeechTentativeCommitment
	default:
		return false
	}
}

func namedSpeakers(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if !isSpeakerLabel(value) {
			out = append(out, value)
		}
	}
	return out
}

func isSpeakerLabel(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "you", "other":
		return true
	default:
		return false
	}
}
