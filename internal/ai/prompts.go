package ai

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/meetinglang"
)

type Extraction struct {
	Title         string            `json:"title"`
	Participants  []string          `json:"participants"`
	Topics        []Topic           `json:"topics"`
	Decisions     []Decision        `json:"decisions"`
	ActionItems   []ExtractedAction `json:"action_items"`
	OpenQuestions []string          `json:"open_questions"`
	Sentiment     string            `json:"sentiment"`
}

type Topic struct {
	Name     string          `json:"name"`
	Summary  string          `json:"summary"`
	Evidence []EvidenceQuote `json:"evidence"`
}

type Decision struct {
	What       string          `json:"what"`
	WhoDecided []string        `json:"who_decided"`
	Context    string          `json:"context"`
	Status     string          `json:"status"`
	Evidence   []EvidenceQuote `json:"evidence"`
}

type ExtractedAction struct {
	Task     string          `json:"task"`
	Owner    string          `json:"owner"`
	Deadline string          `json:"deadline"`
	Evidence []EvidenceQuote `json:"evidence"`
}

type EvidenceQuote struct {
	Speaker string `json:"speaker"`
	Text    string `json:"text"`
}

const extractionSchema = extractionJSONSchema

const stage1System = `You are a meeting analyst. Extract structured information from the transcript.
Output valid JSON matching this schema:
%s
Rules:
- Use only facts directly supported by transcript words
- If transcript is short or vague, return sparse JSON with empty arrays
- Use exact participant names from the transcript; never invent names
- Speaker labels like "You" and "Other" are labels, not participant names
- Participants must be unique; omit labels when names are absent
- Keep arrays short and respect schema maxItems and maxLength limits
- Title must be grounded in the transcript, not generic words like "Meeting" or "Recording"
- Be concise but preserve key details
- Every topic, decision, and action item must include at least one exact evidence quote from the transcript
- Only list decisions with explicit agreement, rejection, or commitment in the evidence quote
- Decision status must be one of: decided, rejected, tentative
- Do not broaden negative scope: rejecting one approach is not rejecting the whole project
- Put exploratory discussion under topics or open questions, not decisions
- Open questions must be work-relevant decisions, blockers, dependencies, or missing facts that still require follow-up after the transcript ends
- Omit answered questions, greetings, small talk, rhetorical questions, resolved logistics, and questions already captured as action items
- Rewrite each retained open question as a standalone question without speaker labels; when uncertain, omit it
- Capture only real follow-up action items; omit casual wrap-up comments
- Leave owner and deadline empty when absent; never write "unspecified" or "unknown"
- Never invent dates, speakers, logistics, budgets, or action owners
- Preserve useful internal codenames, but avoid overstating their role
- Sentiment must be one of: productive, tense, neutral, brainstorming, decision-heavy
%s`

const stage2System = `You are a meeting note-taker. Write clear, actionable meeting notes in markdown.
Format:
## Meeting Title
### Summary
Brief 2-3 sentence overview.
### Key Topics
Use only the Extracted Data topics array.
### Decisions
Use only the Extracted Data decisions array; if it is empty, write exactly "None identified".
Preserve decision status: rejected items are rejected options, tentative items are tentative plans.
Do not infer decisions from title, topics, action items, open questions, transcript wording, or user notes.
### Action Items
Use one flat checkbox list: - [ ] Task description (due: actual date)
Omit due date text when deadline is unknown or unspecified.
Do not add You/Other/person subheadings or use transcript speaker labels as owners.
Only list decisions present in Extracted Data decisions; keep exploratory ideas in Key Topics or Open Questions.
Action Items must be actual follow-up tasks, not meeting wrap-up comments.
Use "None identified" for empty Key Topics, Decisions, Action Items, or Open Questions sections.
Do not add facts absent from Extracted Data.
Never invent names, dates, speakers, logistics, budgets, or action owners.
If evidence is limited, say the transcript has limited detail.
### Open Questions
Bullet list of unresolved questions.
Weight the notes by meeting value, not by how much text each topic produced.
Give most detail to decisions, commitments, actions, blockers, risks, and unresolved questions.
Use user notes as an attention boost, but never as evidence or permission to invent facts.
Treat recurrence as a secondary signal only; repetition, verbosity, duration, and chunk order do not prove importance.
Compress routine status, tangents, logistics, and pleasantries unless they explain an outcome.
A unique outcome should outweigh repeated low-value discussion.
%s`

const stage1RefineSystem = `You are a senior meeting analyst. Consolidate chunk-level meeting extraction into one global extraction.
Output valid JSON matching this schema:
%s
Rules:
- Choose a specific title for the whole meeting, not the first chunk
- Produce a weighted summary of the chunk extractions, not equal coverage of every chunk
- Merge duplicates and near-duplicates before ranking content
- Rank retained items globally: explicit decisions and commitments first; actions, blockers, risks, and unresolved questions next; user-emphasized topics next; recurring central topics next; routine status and tangents last
- Prefer a unique supported outcome over repeated low-value discussion
- Treat recurrence as a secondary signal only; never use repetition, verbosity, duration, item count, or chunk order alone as importance
- Compress or omit routine status, tangents, logistics, and pleasantries unless they explain an outcome
- Keep only work-relevant open questions that still require follow-up after the whole meeting
- Omit answered questions, greetings, small talk, rhetorical questions, resolved logistics, and questions already captured as action items
- Rewrite each retained open question as a standalone question without speaker labels; never concatenate unrelated questions to fit the item limit
- User relevance guidance may boost supported content but must not create facts or suppress unrelated explicit outcomes
- Order each output array from highest to lowest global importance
- Keep arrays short and respect schema maxItems and maxLength limits
- Preserve owners, deadlines, decision context, status, and evidence quotes
- Speaker labels like "You" and "Other" are labels, not participant names
- Only list decisions with explicit agreement, rejection, or commitment in evidence quotes
- Decision status must be one of: decided, rejected, tentative
- Do not broaden negative scope when consolidating rejected options
- Leave owner and deadline empty when absent; never write "unspecified" or "unknown"
- Do not invent facts not present in the input
%s`

const stage3System = `You are a meeting-notes editor. Rewrite notes to be clearer, more actionable, and faithful to the extracted data.
Keep this markdown format:
## Meeting Title
### Summary
### Key Topics
### Decisions
### Action Items
### Open Questions
Rules:
- Apply feedback when provided
- Improve wording, grouping, and missing emphasis
- Keep action items as one flat checklist without You/Other/person subheadings
- Keep due dates only when actual dates are known; never write unknown or unspecified due dates
- Keep Key Topics, Decisions, Action Items, and Open Questions as exact projections of Extracted Data
- Mark rejected decisions as rejected options and tentative decisions as tentative plans
- Do not turn exploratory discussion into decisions
- Do not invent facts not present in extracted data or current notes
%s`

func Stage1Prompt(transcript, language string) (string, string) {
	system := fmt.Sprintf(stage1System, extractionSchema, languageRule(language))
	return system, transcript
}

func Stage2Prompt(extraction string, userNotes string, language string) (string, string) {
	user := fmt.Sprintf("## Extracted Data\n%s", extraction)
	if userNotes != "" {
		user += fmt.Sprintf("\n\n## User Notes\n%s", userNotes)
	}
	return fmt.Sprintf(stage2System, languageRule(language)), user
}

func Stage1RefinePrompt(extraction, relevance, language string) (string, string) {
	system := fmt.Sprintf(stage1RefineSystem, extractionSchema, languageRule(language))
	user := fmt.Sprintf("## Chunk Extractions\n%s", extraction)
	if relevance != "" {
		user += fmt.Sprintf("\n\n## User Relevance Guidance\n%s", relevance)
	}
	return system, user
}

func Stage3Prompt(extraction string, draft string, feedback string, language string) (string, string) {
	user := fmt.Sprintf("## Extracted Data\n%s\n\n## Current Notes\n%s", extraction, draft)
	if feedback != "" {
		user += fmt.Sprintf("\n\n## Feedback\n%s", feedback)
	}
	return fmt.Sprintf(stage3System, languageRule(language)), user
}

func languageRule(language string) string {
	name := meetinglang.Name(language)
	return fmt.Sprintf("- Write all user-facing title, summary, topics, decisions, action items, and questions in %s", name)
}
