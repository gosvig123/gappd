package db

import "database/sql"

// Only the explicit assignment path calls enrollment. Each source contributes once.
func enrollAssignedSpeaker(tx *sql.Tx, meetingID, key string) error {
	if _, err := tx.Exec(`DELETE FROM voice_samples WHERE meeting_id=? AND speaker_key=?`, meetingID, key); err != nil {
		return err
	}
	if !numberedSpeaker.MatchString(key) {
		return nil
	}
	_, err := tx.Exec(`INSERT INTO voice_samples(meeting_id,speaker_key,person_id)
 SELECT ms.meeting_id,ms.speaker_key,ms.person_id FROM meeting_speakers ms
 JOIN meeting_speaker_embeddings e USING(meeting_id,speaker_key)
 JOIN speaker_identity_state state USING(meeting_id,speaker_key)
 WHERE ms.meeting_id=? AND ms.speaker_key=? AND state.origin='manual' AND e.model=?`, meetingID, key, VoiceModel)
	return err
}

func setIdentityOrigin(tx *sql.Tx, meetingID, key, origin string) error {
	_, err := tx.Exec(`INSERT INTO speaker_identity_state(meeting_id,speaker_key,origin) VALUES(?,?,?)
 ON CONFLICT(meeting_id,speaker_key) DO UPDATE SET origin=excluded.origin`, meetingID, key, origin)
	return err
}
