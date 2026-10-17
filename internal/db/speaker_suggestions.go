package db

import "database/sql"

// Suggestions name a likely Person for an unlabeled speaker. They never label a speaker, train a
// profile, or change the transcript; only the user's confirmation does. Unlike auto-fill, they
// consider every saved voice profile, because the user checks each one.
func suggestionMatches(tx *sql.Tx, meetingID string, automatic []speakerMatch) ([]speakerMatch, error) {
	taken := map[string]bool{}
	for _, match := range automatic {
		taken[match.Key], taken[match.PersonID] = true, true
	}
	samples, err := unlabeledSamples(tx, meetingID, taken)
	if err != nil || len(samples) == 0 {
		return nil, err
	}
	profiles, err := queryProfiles(tx, voiceProfilesSQL, VoiceModel, meetingID, meetingID)
	if err != nil {
		return nil, err
	}
	available := profiles[:0]
	for _, profile := range profiles {
		if !taken[profile.PersonID] {
			available = append(available, profile)
		}
	}
	return rankMatches(samples, available, profileSuggestSimilarity), nil
}

func unlabeledSamples(tx *sql.Tx, meetingID string, taken map[string]bool) ([]SpeakerEmbedding, error) {
	rows, err := tx.Query(`SELECT e.speaker_key,e.centroid FROM meeting_speaker_embeddings e
 WHERE e.meeting_id=? AND e.model=? AND NOT EXISTS(SELECT 1 FROM speaker_identity_state st
 WHERE st.meeting_id=e.meeting_id AND st.speaker_key=e.speaker_key AND st.origin<>'automatic')`, meetingID, VoiceModel)
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
		if err == nil && numberedSpeaker.MatchString(key) && !taken[key] {
			samples = append(samples, SpeakerEmbedding{Key: key, Vector: vector})
		}
	}
	return samples, rows.Err()
}

func saveSuggestions(tx *sql.Tx, meetingID string, matches []speakerMatch) error {
	if _, err := tx.Exec(`DELETE FROM speaker_suggestions WHERE meeting_id=?`, meetingID); err != nil {
		return err
	}
	for _, match := range matches {
		if _, err := tx.Exec(`INSERT INTO speaker_suggestions(meeting_id,speaker_key,person_id) VALUES(?,?,?)`,
			meetingID, match.Key, match.PersonID); err != nil {
			return err
		}
	}
	return nil
}

// A label answers the suggestion for that speaker and for the labeled Person.
func retractSuggestions(tx *sql.Tx, meetingID, key string) error {
	_, err := tx.Exec(`DELETE FROM speaker_suggestions WHERE meeting_id=? AND (speaker_key=? OR person_id IN
 (SELECT person_id FROM meeting_speakers WHERE meeting_id=? AND speaker_key=?))`, meetingID, key, meetingID, key)
	return err
}

// SpeakerSuggestions maps speaker keys to suggested Person IDs.
func (d *DB) SpeakerSuggestions(meetingID string) (map[string]string, error) {
	rows, err := d.Conn.Query(`SELECT speaker_key,person_id FROM speaker_suggestions WHERE meeting_id=?`, meetingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key, person string
		if err := rows.Scan(&key, &person); err != nil {
			return nil, err
		}
		out[key] = person
	}
	return out, rows.Err()
}
