package db

import (
	"database/sql"
	"fmt"
)

func (d *DB) AssignSpeaker(meetingID, key string, person Person) error {
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin speaker assignment: %w", err)
	}
	defer tx.Rollback()
	if err := applySpeakerIdentity(tx, meetingID, key, person); err != nil {
		return err
	}
	return tx.Commit()
}

func validateSpeakerAssignment(tx *sql.Tx, meetingID, key string) error {
	if key != SpeakerYou && !numberedSpeaker.MatchString(key) {
		return fmt.Errorf("assign speaker %q: generic audio can contain several people; finish speaker detection first", key)
	}
	var count int
	err := tx.QueryRow(`SELECT COUNT(*) FROM segments s JOIN meetings m ON m.id=s.meeting_id
  WHERE s.meeting_id=? AND s.speaker=? AND m.capture_status=? AND m.transcript IS NOT NULL
  AND m.diarization_state NOT IN (?,?)`, meetingID, key, CaptureStatusCaptured,
		DiarizationStatePending, DiarizationStateProcessing).Scan(&count)
	if err != nil {
		return fmt.Errorf("check speaker %q: %w", key, err)
	}
	if count == 0 {
		return fmt.Errorf("assign speaker %q: speaker unavailable; wait for transcript processing to finish", key)
	}
	return nil
}

func saveSpeakerIdentity(tx *sql.Tx, meetingID, key string, person Person) error {
	if person.ID == "" && person.Name == "" && person.Email == "" {
		_, err := tx.Exec(`DELETE FROM meeting_speakers WHERE meeting_id=? AND speaker_key=?`, meetingID, key)
		return err
	}
	saved, err := resolvePerson(tx, person)
	if err != nil {
		return fmt.Errorf("assign speaker %q: %w; select an existing person or enter a name", key, err)
	}
	_, err = tx.Exec(`INSERT INTO meeting_speakers(meeting_id,speaker_key,person_id) VALUES (?,?,?)
  ON CONFLICT(meeting_id,speaker_key) DO UPDATE SET person_id=excluded.person_id`, meetingID, key, saved.ID)
	return err
}

func refreshSpeakerTranscript(tx *sql.Tx, meetingID string) error {
	rows, err := tx.Query(selectSegmentsSQL, meetingID)
	if err != nil {
		return err
	}
	segments, err := scanSegments(rows)
	rows.Close()
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE meetings SET transcript=?, transcript_revision=transcript_revision+1,
  processing_status=?, processing_status_updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
  processing_failure_message=NULL, processing_claim_token=NULL, processing_claim_expires_at=NULL,
  extraction_json=NULL WHERE id=?`, FormatTranscript(segments), ProcessingStatusPending, meetingID)
	return err
}

func applySpeakerIdentity(tx *sql.Tx, meetingID, key string, person Person) error {
	if err := validateSpeakerAssignment(tx, meetingID, key); err != nil {
		return err
	}
	if err := saveSpeakerIdentity(tx, meetingID, key, person); err != nil {
		return err
	}
	return refreshSpeakerTranscript(tx, meetingID)
}
