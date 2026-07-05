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
	Name    string `json:"name"`
	Summary string `json:"summary"`
}

type Decision struct {
	What       string   `json:"what"`
	WhoDecided []string `json:"who_decided"`
	Context    string   `json:"context"`
}

type ExtractedAction struct {
	Task     string `json:"task"`
	Owner    string `json:"owner"`
	Deadline string `json:"deadline"`
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
- Title must be grounded in the transcript, not generic words like "Meeting" or "Recording"
- Be concise but preserve key details
- Only list decisions with clear agreement or commitment
- Put exploratory discussion under topics or open questions, not decisions
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
Bullet list of topics discussed with key points.
### Decisions
Use only the Extracted Data decisions array; if it is empty, write exactly "None identified".
Do not infer decisions from title, topics, action items, open questions, transcript wording, or user notes.
### Action Items
Use one flat checkbox list: - [ ] Task description (due: actual date)
Omit due date text when deadline is unknown or unspecified.
Do not add You/Other/person subheadings or use transcript speaker labels as owners.
Only list decisions present in Extracted Data decisions; keep exploratory ideas in Key Topics or Open Questions.
Action Items must be actual follow-up tasks, not meeting wrap-up comments.
Use "None identified" for empty Decisions, Action Items, or Open Questions sections.
Do not add facts absent from Extracted Data.
Never invent names, dates, speakers, logistics, budgets, or action owners.
If evidence is limited, say the transcript has limited detail.
### Open Questions
Bullet list of unresolved questions.
If user notes are provided, expand on those topics with additional detail.
%s`

const stage1RefineSystem = `You are a senior meeting analyst. Consolidate chunk-level meeting extraction into one global extraction.
Output valid JSON matching this schema:
%s
Rules:
- Choose a specific title for the whole meeting, not the first chunk
- Merge duplicates and near-duplicates
- Rank topics, decisions, action items, and questions by importance
- Preserve owners, deadlines, and decision context
- Speaker labels like "You" and "Other" are labels, not participant names
- Only list decisions with clear agreement or commitment
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
- Keep Decisions as an exact projection of Extracted Data decisions; if empty, write exactly "None identified"
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

func Stage1RefinePrompt(extraction string, language string) (string, string) {
	system := fmt.Sprintf(stage1RefineSystem, extractionSchema, languageRule(language))
	return system, fmt.Sprintf("## Chunk Extractions\n%s", extraction)
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
