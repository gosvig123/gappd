package ai

import "fmt"

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

const extractionSchema = `{
  "title": "string, 3-8 words, specific, no date, empty if transcript lacks topic context",
  "participants": ["string"],
  "topics": [{"name": "string", "summary": "string"}],
  "decisions": [{"what": "string", "who_decided": ["string"], "context": "string"}],
  "action_items": [{"task": "string", "owner": "string", "deadline": "string"}],
  "open_questions": ["string"],
  "sentiment": "string (productive|tense|neutral|brainstorming|decision-heavy)"
}`

const stage1System = `You are a meeting analyst. Extract structured information from the transcript.
Output valid JSON matching this schema:
%s
Rules:
- Use exact participant names from the transcript
- Title must name the meeting topic, not generic words like "Meeting" or "Recording"
- Be concise but preserve key details
- Capture ALL action items with owners and deadlines when mentioned
- If a deadline is not mentioned, use "unspecified"
- Sentiment must be one of: productive, tense, neutral, brainstorming, decision-heavy`

const stage2System = `You are a meeting note-taker. Write clear, actionable meeting notes in markdown.
Format:
## Meeting Title
### Summary
Brief 2-3 sentence overview.
### Key Topics
Bullet list of topics discussed with key points.
### Decisions
Numbered list of decisions made.
### Action Items
Use checkbox format: - [ ] Task description (@owner, due: date)
### Open Questions
Bullet list of unresolved questions.
If user notes are provided, expand on those topics with additional detail.`

const stage1RefineSystem = `You are a senior meeting analyst. Consolidate chunk-level meeting extraction into one global extraction.
Output valid JSON matching this schema:
%s
Rules:
- Choose a specific title for the whole meeting, not the first chunk
- Merge duplicates and near-duplicates
- Rank topics, decisions, action items, and questions by importance
- Preserve owners, deadlines, and decision context
- Do not invent facts not present in the input`

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
- Keep action items checkable with owner and due date when available
- Do not invent facts not present in extracted data or current notes`

func Stage1Prompt(transcript string) (string, string) {
	system := fmt.Sprintf(stage1System, extractionSchema)
	return system, transcript
}

func Stage2Prompt(extraction string, userNotes string) (string, string) {
	user := fmt.Sprintf("## Extracted Data\n%s", extraction)
	if userNotes != "" {
		user += fmt.Sprintf("\n\n## User Notes\n%s", userNotes)
	}
	return stage2System, user
}

func Stage1RefinePrompt(extraction string) (string, string) {
	system := fmt.Sprintf(stage1RefineSystem, extractionSchema)
	return system, fmt.Sprintf("## Chunk Extractions\n%s", extraction)
}

func Stage3Prompt(extraction string, draft string, feedback string) (string, string) {
	user := fmt.Sprintf("## Extracted Data\n%s\n\n## Current Notes\n%s", extraction, draft)
	if feedback != "" {
		user += fmt.Sprintf("\n\n## Feedback\n%s", feedback)
	}
	return stage3System, user
}
