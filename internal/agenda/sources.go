package agenda

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
)

// SourceKindMeetingNotes is the notes data of one Meeting. Each Agenda source kind
// becomes Documents of its own kind; the prompt and the reference check use only Documents.
const SourceKindMeetingNotes = "meeting_notes"

// Document is one piece of evidence an Agenda item can cite.
type Document struct {
	Ref   string `json:"ref"`
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Title string `json:"title"`
	Date  string `json:"date"`
	Text  string `json:"-"`
}

// MeetingNotesDocuments renders the notes data of Related Meetings, in their order.
// A Meeting whose notes data does not parse or is empty is skipped.
func MeetingNotesDocuments(related []Related) []Document {
	documents := make([]Document, 0, len(related))
	for _, item := range related {
		var extraction ai.Extraction
		if err := json.Unmarshal([]byte(item.Meeting.ExtractionJSON), &extraction); err != nil {
			continue
		}
		text := notesText(extraction)
		if text == "" {
			continue
		}
		documents = append(documents, Document{
			Ref: fmt.Sprintf("S%d", len(documents)+1), Kind: SourceKindMeetingNotes, ID: item.Meeting.ID,
			Title: item.Meeting.Title, Date: item.Meeting.StartedAt, Text: text,
		})
	}
	return documents
}

func notesText(extraction ai.Extraction) string {
	var b strings.Builder
	for _, topic := range extraction.Topics {
		line(&b, "Topic", strings.TrimSuffix(topic.Name+": "+topic.Summary, ": "))
	}
	for _, decision := range extraction.Decisions {
		line(&b, "Decision ("+decision.Status+")", decision.What)
	}
	for _, action := range extraction.ActionItems {
		text := action.Task
		if action.Owner != "" {
			text += " (owner: " + action.Owner + ")"
		}
		if action.Deadline != "" {
			text += " (due: " + action.Deadline + ")"
		}
		line(&b, "Action item", text)
	}
	for _, question := range extraction.OpenQuestions {
		line(&b, "Open question", question)
	}
	return strings.TrimSpace(b.String())
}

func line(b *strings.Builder, label, text string) {
	if text = strings.TrimSpace(text); text != "" {
		fmt.Fprintf(b, "- %s: %s\n", label, text)
	}
}
