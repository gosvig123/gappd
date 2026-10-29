package appprotocol

import "github.com/gappd-dev/gappd/internal/agenda"

// AgendaInput carries the upcoming event and the past Meetings' linked events as JSON,
// because command arguments are strings: Event is an agenda.Event and Linked an
// array of agenda.LinkedMeeting.
type AgendaInput struct {
	Event  string `json:"event"`
	Linked string `json:"linked"`
}

// AgendaSource is one Document an Agenda item can cite, such as one Meeting's notes.
type AgendaSource struct {
	Ref   string `json:"ref"`
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Title string `json:"title"`
	Date  string `json:"date"`
}

type AgendaItem struct {
	Text    string   `json:"text"`
	Sources []string `json:"sources"`
}

// AgendaResponse is empty when no Related Meeting has notes data.
type AgendaResponse struct {
	Items   []AgendaItem   `json:"items"`
	Sources []AgendaSource `json:"sources"`
}

func BuildAgenda(items []agenda.Item, documents []agenda.Document) AgendaResponse {
	out := AgendaResponse{Items: make([]AgendaItem, 0, len(items)), Sources: make([]AgendaSource, 0, len(documents))}
	for _, item := range items {
		out.Items = append(out.Items, AgendaItem{Text: item.Text, Sources: item.Sources})
	}
	for _, document := range documents {
		out.Sources = append(out.Sources, AgendaSource{Ref: document.Ref, Kind: document.Kind, ID: document.ID, Title: document.Title, Date: document.Date})
	}
	return out
}
