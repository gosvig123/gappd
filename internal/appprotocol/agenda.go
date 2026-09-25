package appprotocol

import "github.com/gappd-dev/gappd/internal/ai"

type AgendaInput struct {
	Title              string `json:"title"`
	MeetingIDs         string `json:"meetingIds"`
	CommunicationInput string `json:"communicationInput,omitempty"`
}

type AgendaResponse struct {
	Items      []AgendaItem     `json:"items"`
	Generation AgendaGeneration `json:"generation"`
}

// AgendaGeneration records the provider snapshot that produced a draft.
type AgendaGeneration struct {
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

type AgendaItem ai.AgendaItem

func BuildAgenda(draft ai.AgendaDraft, generation AgendaGeneration) AgendaResponse {
	items := make([]AgendaItem, 0, len(draft.Items))
	for _, item := range draft.Items {
		items = append(items, AgendaItem(item))
	}
	return AgendaResponse{Items: items, Generation: generation}
}

type AgendaHistoryMeeting struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	StartedAt string   `json:"startedAt"`
	EndedAt   string   `json:"endedAt"`
	Emails    []string `json:"emails"`
}

type AgendaHistoryResponse struct {
	Meetings []AgendaHistoryMeeting `json:"meetings"`
}
