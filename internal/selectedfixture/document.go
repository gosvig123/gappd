// Package selectedfixture permits only one fabricated local Meeting document.
package selectedfixture

import (
	"encoding/json"
	"errors"

	"github.com/gappd-dev/gappd/internal/db"
)

const ID = "72619a1d-f713-4f46-a2b8-c74e568726b1"
const Title = "SYNTHETIC: Selected local Meeting"
const Transcript = "[00:00] Synthetic speaker: Review the fictional paper prototype."
const Summary = "Fabricated participants will review a fictional paper prototype."
const StartedAt = "2026-09-14T12:00:00Z"
const Marker = "gappd-selected-local-fixture-v1\n"

const Bytes = `{"version":1,"local_id":"72619a1d-f713-4f46-a2b8-c74e568726b1","title":"SYNTHETIC: Selected local Meeting","transcript":"[00:00] Synthetic speaker: Review the fictional paper prototype.","summary":"Fabricated participants will review a fictional paper prototype.","started_at":"2026-09-14T12:00:00Z","revision":1}`

type Document struct {
	Version    int    `json:"version"`
	LocalID    string `json:"local_id"`
	Title      string `json:"title"`
	Transcript string `json:"transcript"`
	Summary    string `json:"summary"`
	StartedAt  string `json:"started_at"`
	Revision   int    `json:"revision"`
}

func Serialize(m *db.Meeting) ([]byte, error) {
	if m == nil || m.ID != ID || m.Transcript == nil || m.Summary == nil || m.TranscriptRevision != 1 || m.SummaryTranscriptRevision != 1 {
		return nil, errors.New("selected fixture unavailable")
	}
	document := Document{1, m.ID, m.Title, *m.Transcript, *m.Summary, m.StartedAt, m.TranscriptRevision}
	data, err := json.Marshal(document)
	if err != nil || string(data) != Bytes {
		return nil, errors.New("selected fixture changed")
	}
	return data, nil
}

func Meeting() *db.Meeting {
	transcript, summary := Transcript, Summary
	return &db.Meeting{ID: ID, Title: Title, StartedAt: StartedAt, EndedAt: pointer(StartedAt), CaptureStatus: db.CaptureStatusCaptured,
		CaptureStatusUpdatedAt: StartedAt, ProcessingStatus: db.ProcessingStatusCompleted, ProcessingStatusUpdatedAt: StartedAt,
		Transcript: &transcript, Summary: &summary, TranscriptRevision: 1, SummaryTranscriptRevision: 1, Source: "synthetic"}
}

func pointer(s string) *string { return &s }
