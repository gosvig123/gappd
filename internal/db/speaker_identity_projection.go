package db

import "database/sql"

// Speaker numbers may change on a retry. Keep identities only if the partition is unchanged.
func reconcileSpeakerIdentities(tx *sql.Tx, meetingID string, segments []Segment, assignments map[string]SpeakerProjectionAssignment) error {
	if !speakerPartitionChanged(segments, assignments) {
		return nil
	}
	_, err := tx.Exec(`DELETE FROM meeting_speakers WHERE meeting_id=? AND speaker_key IN
  (SELECT speaker FROM segments WHERE meeting_id=? AND speaker_source=?)`, meetingID, meetingID, SegmentSourceSystem)
	if err != nil {
		return err
	}
	for i := range segments {
		if segments[i].SpeakerSource != nil && *segments[i].SpeakerSource == SegmentSourceSystem {
			segments[i].Speaker, segments[i].PersonID = segments[i].RawSpeaker(), nil
			segments[i].SpeakerKey = ""
		}
	}
	return nil
}

func speakerPartitionChanged(segments []Segment, assignments map[string]SpeakerProjectionAssignment) bool {
	for _, segment := range segments {
		assignment, ok := assignments[segment.ID]
		if ok && string(assignment.Speaker) != segment.RawSpeaker() {
			return true
		}
	}
	return false
}
