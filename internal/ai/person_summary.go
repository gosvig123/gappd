package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/meetinglang"
)

const maxPersonSummaryTokens = 512

const personSummarySchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {"summary": {"type": "string", "maxLength": 320}},
  "required": ["summary"]
}`

const personSummarySystem = `You keep a personal CRM. Sum up one person from facts that earlier meetings noted about them, so the user remembers who they are before the next meeting.
Output valid JSON matching this schema:
%s
Rules:
- Write one to three short sentences, most useful first: role and company, then what matters to them now, then a personal detail worth remembering
- Use only the given facts; never add, guess, or combine them into new claims
- Never write a person's name; start without a subject, like "Leads partnerships at …"
- Refer to family, friends, and colleagues by role only
- When facts disagree, prefer the newest
- Write in %s`

// SummarizePerson writes a short About summary from facts, newest first. It returns an empty
// summary for no facts, and an error for a summary that holds a speaker label.
func SummarizePerson(ctx context.Context, provider Provider, facts []string, language string) (string, error) {
	if len(facts) == 0 {
		return "", nil
	}
	user := "## Facts, newest first\n- " + strings.Join(facts, "\n- ")
	raw, err := provider.CompleteJSON(ctx, CompletionRequest{System: fmt.Sprintf(personSummarySystem, personSummarySchema, meetinglang.Name(language)), User: user, Temperature: structuredTemperature, JSONSchema: json.RawMessage(personSummarySchema), MaxTokens: maxPersonSummaryTokens})
	if err != nil {
		return "", fmt.Errorf("write person summary: %w", err)
	}
	var out struct {
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("write person summary: read provider JSON: %w", err)
	}
	summary := strings.TrimSpace(out.Summary)
	if speakerLabelPattern.MatchString(summary) {
		return "", fmt.Errorf("write person summary: the model wrote a speaker label; try again")
	}
	return summary, nil
}
