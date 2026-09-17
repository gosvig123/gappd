package service

import (
	"encoding/json"
	"errors"
)

const SelectedFixtureBytes = `{"version":1,"local_id":"72619a1d-f713-4f46-a2b8-c74e568726b1","title":"SYNTHETIC: Selected local Meeting","transcript":"[00:00] Synthetic speaker: Review the fictional paper prototype.","summary":"Fabricated participants will review a fictional paper prototype.","started_at":"2026-09-14T12:00:00Z","revision":1}`

type SelectedDocument struct {
	Version    int    `json:"version"`
	LocalID    string `json:"local_id"`
	Title      string `json:"title"`
	Transcript string `json:"transcript"`
	Summary    string `json:"summary"`
	StartedAt  string `json:"started_at"`
	Revision   int    `json:"revision"`
}

func ParseSelectedDocument(data []byte) (SelectedDocument, error) {
	var document SelectedDocument
	if string(data) != SelectedFixtureBytes {
		return document, errors.New("fixture document required")
	}
	err := json.Unmarshal(data, &document)
	return document, err
}
