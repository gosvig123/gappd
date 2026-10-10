package db

import (
	"database/sql"
	"fmt"
)

func (d *DB) RecognizeSpeakers(meetingID string, revision int, emails []string, calendar bool) error {
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin speaker recognition: %w", err)
	}
	defer tx.Rollback()
	if err := checkRecognitionRevision(tx, meetingID, revision); err != nil {
		return err
	}
	matches, err := recognitionMatches(tx, meetingID, emails, calendar)
	if err != nil {
		return err
	}
	changed, err := saveVoiceMatches(tx, meetingID, matches)
	if err != nil {
		return err
	}
	if changed {
		if err := refreshSpeakerTranscript(tx, meetingID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func recognitionMatches(tx *sql.Tx, meetingID string, emails []string, calendar bool) ([]speakerMatch, error) {
	samples, err := loadRecognitionSamples(tx, meetingID)
	if err != nil {
		return nil, err
	}
	profiles, err := loadCandidateProfiles(tx, meetingID, emails, calendar)
	if err != nil {
		return nil, err
	}
	return matchProfiles(samples, profiles), nil
}

func loadRecognitionSamples(tx *sql.Tx, meetingID string) ([]SpeakerEmbedding, error) {
	rows, err := tx.Query(`SELECT e.speaker_key,e.centroid FROM meeting_speaker_embeddings e
 WHERE e.meeting_id=? AND e.model=?
 AND NOT EXISTS(SELECT 1 FROM speaker_identity_state st WHERE st.meeting_id=e.meeting_id AND st.origin='cleared' AND st.speaker_key GLOB 'Speaker [1-9]*')
 AND NOT EXISTS(SELECT 1 FROM meeting_speakers ms WHERE ms.meeting_id=e.meeting_id AND ms.speaker_key=e.speaker_key
 AND NOT EXISTS(SELECT 1 FROM speaker_identity_state st WHERE st.meeting_id=ms.meeting_id AND st.speaker_key=ms.speaker_key AND st.origin='automatic'))`, meetingID, VoiceModel)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	samples := []SpeakerEmbedding{}
	for rows.Next() {
		var key, raw string
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		vector, err := decodeCentroid(raw)
		if err == nil && numberedSpeaker.MatchString(key) {
			samples = append(samples, SpeakerEmbedding{Key: key, Vector: vector})
		}
	}
	return samples, rows.Err()
}

func saveVoiceMatches(tx *sql.Tx, meetingID string, matches []speakerMatch) (bool, error) {
	previous, err := automaticIdentities(tx, meetingID)
	if err != nil {
		return false, err
	}
	next := map[string]string{}
	for _, match := range matches {
		next[match.Key] = match.PersonID
	}
	if sameIdentities(previous, next) {
		return false, nil
	}
	if err := removeAutomaticIdentities(tx, meetingID, previous); err != nil {
		return false, err
	}
	if err := insertAutomaticIdentities(tx, meetingID, next); err != nil {
		return false, err
	}
	return true, nil
}

func automaticIdentities(tx *sql.Tx, meetingID string) (map[string]string, error) {
	rows, err := tx.Query(`SELECT ms.speaker_key,ms.person_id FROM meeting_speakers ms
 JOIN speaker_identity_state st USING(meeting_id,speaker_key) WHERE ms.meeting_id=? AND st.origin='automatic'`, meetingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key, id string
		if err := rows.Scan(&key, &id); err != nil {
			return nil, err
		}
		out[key] = id
	}
	return out, rows.Err()
}

func sameIdentities(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func checkRecognitionRevision(tx *sql.Tx, meetingID string, revision int) error {
	var ready bool
	err := tx.QueryRow(`SELECT transcript_revision=? AND capture_status='captured' AND
 diarization_state='completed' AND (`+voiceProcessingAvailableSQL+`) FROM meetings WHERE id=?`, revision, meetingID).Scan(&ready)
	if err != nil {
		return err
	}
	if !ready {
		return fmt.Errorf("recognize speakers: Meeting changed or is processing; retry with current revision")
	}
	return nil
}

func removeAutomaticIdentities(tx *sql.Tx, meetingID string, previous map[string]string) error {
	for key := range previous {
		if _, err := tx.Exec(`DELETE FROM meeting_speakers WHERE meeting_id=? AND speaker_key=?`, meetingID, key); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM speaker_identity_state WHERE meeting_id=? AND speaker_key=?`, meetingID, key); err != nil {
			return err
		}
	}
	return nil
}

func insertAutomaticIdentities(tx *sql.Tx, meetingID string, next map[string]string) error {
	for key, personID := range next {
		if err := validateSpeakerAssignment(tx, meetingID, key); err != nil {
			return err
		}
		if err := saveSpeakerIdentity(tx, meetingID, key, Person{ID: personID}); err != nil {
			return err
		}
		if err := setIdentityOrigin(tx, meetingID, key, "automatic"); err != nil {
			return err
		}
	}
	return nil
}
