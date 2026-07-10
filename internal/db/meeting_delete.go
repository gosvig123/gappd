package db

import (
	"database/sql"
	"fmt"
)

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

func rowsChanged(result sql.Result, err error, operation string) (bool, error) {
	if err != nil {
		return false, fmt.Errorf("%s: %w", operation, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("%s rows affected: %w", operation, err)
	}
	return rows > 0, nil
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
	ok, err := rowsChanged(result, err, fmt.Sprintf("delete meeting %s", id))
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
