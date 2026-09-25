package appprotocol

import "github.com/gappd-dev/gappd/internal/ai"

type EnrichInput struct {
	ID                 string `json:"id"`
	CommunicationInput string `json:"communicationInput"`
}

type EnrichResponse struct {
	Notes      []EnrichmentNote `json:"notes"`
	Trimmed    bool             `json:"trimmed"`
	Generation AgendaGeneration `json:"generation"`
}

type EnrichmentNote ai.EnrichmentNote

func BuildEnrichment(notes []ai.EnrichmentNote, trimmed bool, generation AgendaGeneration) EnrichResponse {
	views := make([]EnrichmentNote, 0, len(notes))
	for _, note := range notes {
		views = append(views, EnrichmentNote(note))
	}
	return EnrichResponse{Notes: views, Trimmed: trimmed, Generation: generation}
}
