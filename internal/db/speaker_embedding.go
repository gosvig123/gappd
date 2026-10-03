package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
)

// Pinned offline WeSpeaker model; changing the model requires a new identity.
const VoiceModel = "fluidaudio-offline-vbx/300165b240c45375add402265f62410b6df33cf1+gappd.1/wespeaker-256/v1"
const SpeakerEmbeddingDimension = 256
const MinimumVoiceSeconds = 15.0
const MinimumVoiceQuality = 0.8

type SpeakerEmbedding struct {
	Key     string
	Vector  []float64
	Model   string
	Source  string
	Seconds float64
	Quality float64
}

func replaceSpeakerEmbeddings(tx *sql.Tx, meetingID string, embeddings []SpeakerEmbedding) error {
	if _, err := tx.Exec(`DELETE FROM meeting_speaker_embeddings WHERE meeting_id=?`, meetingID); err != nil {
		return err
	}
	for _, embedding := range embeddings {
		if err := insertSpeakerEmbedding(tx, meetingID, embedding); err != nil {
			return err
		}
	}
	return nil
}

func insertSpeakerEmbedding(tx *sql.Tx, meetingID string, e SpeakerEmbedding) error {
	if !numberedSpeaker.MatchString(e.Key) || e.Model != VoiceModel || e.Source == "" ||
		!finiteVector([]float64{e.Seconds, e.Quality}) || e.Seconds < MinimumVoiceSeconds ||
		e.Quality < MinimumVoiceQuality || e.Quality > 1 {
		return nil
	}
	raw, err := encodeCentroid(e.Vector)
	if err != nil {
		return nil
	} // Ineligible voice evidence must not fail transcript processing.
	_, err = tx.Exec(`INSERT INTO meeting_speaker_embeddings(meeting_id,speaker_key,centroid,model,source)
 SELECT ?,?,?,?,? || '/revision:' || (SELECT transcript_revision FROM meetings WHERE id=?) WHERE EXISTS(SELECT 1 FROM segments WHERE meeting_id=? AND speaker=? AND speaker_source='system')`,
		meetingID, e.Key, raw, e.Model, e.Source, meetingID, meetingID, e.Key)
	return err
}

func encodeCentroid(vector []float64) (string, error) {
	normalized, err := normalizeVoice(vector)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(normalized)
	return string(raw), err
}

func decodeCentroid(raw string) ([]float64, error) {
	var vector []float64
	if err := json.Unmarshal([]byte(raw), &vector); err != nil {
		return nil, err
	}
	return normalizeVoice(vector)
}

func normalizeVoice(vector []float64) ([]float64, error) {
	if len(vector) != SpeakerEmbeddingDimension || !finiteVector(vector) {
		return nil, fmt.Errorf("invalid voice dimension or value")
	}
	norm := 0.0
	for _, value := range vector {
		norm = math.Hypot(norm, value)
	}
	if norm == 0 || math.IsInf(norm, 0) {
		return nil, fmt.Errorf("invalid voice norm")
	}
	out := make([]float64, len(vector))
	for i, value := range vector {
		out[i] = value / norm
	}
	return out, nil
}

func finiteVector(vector []float64) bool {
	for _, value := range vector {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}
