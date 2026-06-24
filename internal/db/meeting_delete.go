package db

import "fmt"

func (d *DB) DeleteMeeting(id string) (*Meeting, error) {
	meeting, err := d.GetMeeting(id)
	if err != nil {
		return nil, fmt.Errorf("load meeting before delete: %w", err)
	}
	if !MeetingCanDelete(*meeting) {
		return nil, fmt.Errorf("delete meeting %s: stop recording or wait for processing to finish", id)
	}
	if err := d.deleteMeetingRows(id); err != nil {
		return nil, err
	}
	return meeting, nil
}

func MeetingCanDelete(meeting Meeting) bool {
	return meeting.CaptureStatus != CaptureStatusRecording && meeting.ProcessingStatus != ProcessingStatusProcessing
}

func (d *DB) deleteMeetingRows(id string) error {
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin delete meeting %s: %w", id, err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(deleteSegmentsSQL, id); err != nil {
		return fmt.Errorf("delete segments for meeting %s: %w", id, err)
	}
	result, err := tx.Exec(`DELETE FROM meetings WHERE id = ? AND capture_status <> ? AND processing_status <> ?`, id, CaptureStatusRecording, ProcessingStatusProcessing)
	ok, err := changed(result, err, fmt.Sprintf("delete meeting %s", id))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("delete meeting %s: meeting changed; stop recording or wait for processing to finish", id)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete meeting %s: %w", id, err)
	}
	return nil
}
