package appprotocol

import "github.com/gappd-dev/gappd/internal/ai"

type AgendaInput struct {
	Title      string `json:"title"`
	MeetingIDs string `json:"meetingIds"`
}

type AgendaResponse struct {
	Items []AgendaItem `json:"items"`
}

type AgendaItem ai.AgendaItem

func BuildAgenda(draft ai.AgendaDraft) AgendaResponse {
	items := make([]AgendaItem, 0, len(draft.Items))
	for _, item := range draft.Items {
		items = append(items, AgendaItem(item))
	}
	return AgendaResponse{Items: items}
}

type AgendaHistoryMeeting struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	StartedAt string   `json:"startedAt"`
	Emails    []string `json:"emails"`
}

type AgendaHistoryResponse struct {
	Meetings []AgendaHistoryMeeting `json:"meetings"`
}
