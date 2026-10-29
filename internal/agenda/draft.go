package agenda

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/meetinglang"
)

const (
	maxItems       = 8
	maxDraftTokens = 2048
)

// Item is one Agenda point. Sources holds the Refs of the Documents it comes from.
type Item struct {
	Text    string   `json:"text"`
	Sources []string `json:"sources"`
}

const draftSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "items": {"type": "array", "maxItems": 8, "items": {"type": "object", "additionalProperties": false, "properties": {
      "text": {"type": "string", "maxLength": 200},
      "sources": {"type": "array", "minItems": 1, "maxItems": 3, "items": {"type": "string", "maxLength": 8}}
    }, "required": ["text", "sources"]}}
  },
  "required": ["items"]
}`

const draftSystem = `You prepare the agenda for the next meeting with the same people.
The sources are notes of earlier meetings with them, ordered by relatedness: same series first, then invitee overlap. Each source has a reference such as S1.
Output valid JSON matching this schema:
%s
Rules:
- Write at most 8 short agenda items, most important first
- Put first: action items to check on, open questions that still need an answer, and tentative decisions to confirm
- Then add topics that the earlier meetings left unfinished
- Write each item as one standalone line without speaker labels
- Keep owner names and due dates from the sources
- Cite the reference of every source an item comes from
- Omit items that a newer source shows as done, answered, or decided
- Omit greetings, small talk, and routine status
- Use only facts in the sources; never invent names, dates, numbers, or tasks
- If the sources hold nothing to follow up, return an empty items array
- Write all items in %s`

// Draft asks the provider for Agenda items and keeps only items that cite a given Document.
func Draft(ctx context.Context, provider ai.Provider, documents []Document, language string) ([]Item, error) {
	if len(documents) == 0 {
		return []Item{}, nil
	}
	system, user := draftPrompt(documents, language)
	raw, err := provider.CompleteJSON(ctx, ai.CompletionRequest{System: system, User: user, JSONSchema: json.RawMessage(draftSchema), MaxTokens: maxDraftTokens})
	if err != nil {
		return nil, fmt.Errorf("draft agenda: %w", err)
	}
	var out struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("draft agenda: read provider JSON: %w", err)
	}
	return checkItems(out.Items, documents), nil
}

func draftPrompt(documents []Document, language string) (string, string) {
	var b strings.Builder
	b.WriteString("## Sources\n")
	for _, document := range documents {
		fmt.Fprintf(&b, "\n### %s · %s · %q · %s\n%s\n", document.Ref, sourceLabel(document.Kind), document.Title, dateOnly(document.Date), document.Text)
	}
	return fmt.Sprintf(draftSystem, draftSchema, meetinglang.Name(language)), b.String()
}

func sourceLabel(kind string) string {
	if kind == SourceKindMeetingNotes {
		return "Meeting notes"
	}
	return kind
}

func dateOnly(value string) string {
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

// checkItems drops unknown references, items without a known reference, empty
// text, and repeated text, and keeps at most maxItems.
func checkItems(items []Item, documents []Document) []Item {
	known := make(map[string]bool, len(documents))
	for _, document := range documents {
		known[document.Ref] = true
	}
	seen := map[string]bool{}
	out := make([]Item, 0, len(items))
	for _, item := range items {
		text := strings.TrimSpace(item.Text)
		key := strings.ToLower(text)
		if text == "" || seen[key] {
			continue
		}
		sources := make([]string, 0, len(item.Sources))
		for _, ref := range item.Sources {
			if ref = strings.TrimSpace(ref); known[ref] && !slices.Contains(sources, ref) {
				sources = append(sources, ref)
			}
		}
		if len(sources) == 0 {
			continue
		}
		seen[key] = true
		out = append(out, Item{Text: text, Sources: sources})
		if len(out) == maxItems {
			break
		}
	}
	return out
}
