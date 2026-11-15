package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gappd-dev/gappd/internal/meetinglang"
)

const maxPersonFactsTokens = 4096

// PersonFactKinds are the groups of a Person fact, in display order.
var PersonFactKinds = []string{"work", "personal", "preference", "interest", "goal"}

// PersonFact is one durable fact about one Meeting speaker, said by that speaker.
type PersonFact struct {
	Speaker  string          `json:"speaker"`
	Kind     string          `json:"kind"`
	Text     string          `json:"text"`
	Evidence []EvidenceQuote `json:"evidence"`
}

const personFactsSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "facts": {"type": "array", "maxItems": 30, "items": {"type": "object", "additionalProperties": false, "properties": {
      "speaker": {"type": "string", "maxLength": 40},
      "kind": {"type": "string", "enum": ["work", "personal", "preference", "interest", "goal"]},
      "text": {"type": "string", "maxLength": 160},
      "evidence": {"type": "array", "minItems": 1, "maxItems": 2, "items": {"type": "object", "additionalProperties": false, "properties": {"speaker": {"type": "string", "maxLength": 40}, "text": {"type": "string", "maxLength": 220}}, "required": ["speaker", "text"]}}
    }, "required": ["speaker", "kind", "text", "evidence"]}}
  },
  "required": ["facts"]
}`

const personFactsSystem = `You keep a personal CRM. From a meeting transcript, note durable facts about each speaker that will help the user know this person better at the next meeting.
Each transcript line starts with a speaker label in brackets. Write facts only about these speakers: %s
Output valid JSON matching this schema:
%s
Kinds:
- work: role, company, team, responsibilities, career history, current job situation
- personal: family, home, location, life events, health, travel, background
- preference: how they like to work, communicate, decide, or be contacted
- interest: hobbies, topics they care about or follow
- goal: what they want to achieve, worry about, or need help with
Rules:
- Note only facts the speaker says about themselves, their life, or their work
- Note facts that will still be true or useful in a month; omit tasks, decisions, project status, and meeting logistics that the meeting notes already hold
- Note concrete, specific facts; omit generic traits read from one phrase, such as "values transparency" or "is detail-oriented"
- Omit what the speaker said about the work of this meeting unless it tells their role, company, or responsibilities
- Never write the name of any person, including the speaker; write each fact without a subject, like "Has a daughter who starts school in September"
- Refer to family, friends, and colleagues by role only ("their daughter", "a former manager"), never by name, age, school, or other identifying detail
- Company, product, place, and tool names are allowed
- Every fact needs at least one exact evidence quote that the same speaker said in the transcript, with that speaker's label
- Use only facts directly supported by transcript words; never guess
- Write each fact as one short standalone line
- If there is nothing to note, return an empty facts array
- Write all facts in %s`

// ExtractPersonFacts reads one labeled transcript and returns facts about the given speakers.
// A fact survives only when its speaker is one of speakers and one of its quotes is that
// speaker's and appears in the transcript.
func ExtractPersonFacts(ctx context.Context, provider Provider, transcript string, speakers []string, language string) ([]PersonFact, error) {
	if len(speakers) == 0 || strings.TrimSpace(transcript) == "" {
		return []PersonFact{}, nil
	}
	chunkChars := localTranscriptChunkChars
	if sizer, ok := provider.(chunkSizer); ok {
		chunkChars = sizer.transcriptChunkChars()
	}
	system := fmt.Sprintf(personFactsSystem, strings.Join(speakers, ", "), personFactsSchema, meetinglang.Name(language))
	var facts []PersonFact
	for _, chunk := range transcriptChunks(transcript, chunkChars) {
		raw, err := provider.CompleteJSON(ctx, CompletionRequest{System: system, User: "## Transcript\n" + chunk, Temperature: structuredTemperature, JSONSchema: json.RawMessage(personFactsSchema), MaxTokens: maxPersonFactsTokens})
		if err != nil {
			return nil, fmt.Errorf("extract person facts: %w", err)
		}
		var out struct {
			Facts []PersonFact `json:"facts"`
		}
		if err := json.Unmarshal(raw, &out); err != nil {
			return nil, fmt.Errorf("extract person facts: read provider JSON: %w", err)
		}
		facts = append(facts, out.Facts...)
	}
	return checkPersonFacts(facts, transcript, speakers), nil
}

// speakerLabelPattern finds a speaker label in fact text, which the user must never see.
var speakerLabelPattern = regexp.MustCompile(`(?i)\bspeaker[\s\p{Z}]*\d+\b`)

// checkPersonFacts drops facts with an unknown speaker or kind, empty or repeated text, a
// speaker label in the text, or no quote that their speaker said.
func checkPersonFacts(facts []PersonFact, transcript string, speakers []string) []PersonFact {
	spoken := speakerWords(transcript)
	seen := map[string]bool{}
	out := make([]PersonFact, 0, len(facts))
	for _, fact := range facts {
		fact.Speaker, fact.Text = strings.TrimSpace(fact.Speaker), strings.TrimSpace(fact.Text)
		key := strings.ToLower(fact.Speaker + "\x00" + fact.Text)
		if fact.Text == "" || seen[key] || !slices.Contains(speakers, fact.Speaker) || !slices.Contains(PersonFactKinds, fact.Kind) || speakerLabelPattern.MatchString(fact.Text) {
			continue
		}
		quotes := make([]EvidenceQuote, 0, len(fact.Evidence))
		for _, quote := range fact.Evidence {
			if saidWordForWord(quote.Text, spoken[fact.Speaker]) {
				quotes = append(quotes, EvidenceQuote{Speaker: fact.Speaker, Text: strings.TrimSpace(quote.Text)})
			}
		}
		if len(quotes) == 0 {
			continue
		}
		seen[key] = true
		fact.Evidence = quotes
		out = append(out, fact)
	}
	return out
}

// minQuoteRunes is the shortest quote, in letters and digits, that counts as evidence.
const minQuoteRunes = 8

// saidWordForWord reports whether the speaker said the quote word for word. Case, spaces and
// punctuation do not count, so it works in scripts without spaces between words too.
func saidWordForWord(quote, spoken string) bool {
	quote = lettersAndDigits(quote)
	return utf8.RuneCountInString(quote) >= minQuoteRunes && strings.Contains(lettersAndDigits(spoken), quote)
}

func lettersAndDigits(text string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, text)
}

// speakerWords joins the lines of each speaker in a labeled transcript ("[Speaker 1] text"),
// without labels, so a quote can span lines that one speaker said one after another.
func speakerWords(transcript string) map[string]string {
	lines := map[string][]string{}
	for _, line := range strings.Split(transcript, "\n") {
		label, text, ok := strings.Cut(strings.TrimPrefix(line, "["), "] ")
		if ok && strings.HasPrefix(line, "[") {
			lines[label] = append(lines[label], text)
		}
	}
	spoken := make(map[string]string, len(lines))
	for label, texts := range lines {
		spoken[label] = strings.Join(texts, " ")
	}
	return spoken
}
