package db

import (
	"context"
	"database/sql"
	"fmt"
)

// DeleteMeeting holds a SQLite write reservation while removing managed files,
// so capture or processing cannot start between the state check and file removal.
// A file error rolls back the deletion, leaving the Meeting available for retry.
func (d *DB) DeleteMeeting(id string, removeArtifacts func(*string) error) (*Meeting, error) {
	ctx := context.Background()
	conn, err := d.Conn.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire delete connection: %w", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return nil, fmt.Errorf("begin delete meeting %s: %w", id, err)
	}
	defer conn.ExecContext(ctx, "ROLLBACK")
	meeting, err := scanMeetingRow(conn.QueryRowContext(ctx, selectMeetingsSQL+` WHERE id=?`, id))
	if err != nil {
		return nil, fmt.Errorf("load meeting before delete: %w", err)
	}
	if !MeetingCanDelete(meeting) {
		return nil, fmt.Errorf("delete meeting %s: stop recording or wait for processing to finish", id)
	}
	if err := removeArtifacts(meeting.AudioPath); err != nil {
		return nil, fmt.Errorf("delete Meeting %s artifacts (Meeting kept; retry deletion): %w", id, err)
	}
	if _, err := conn.ExecContext(ctx, deleteSegmentsSQL, id); err != nil {
		return nil, fmt.Errorf("delete segments for meeting %s: %w", id, err)
	}
	result, err := conn.ExecContext(ctx, `DELETE FROM meetings WHERE id = ? AND capture_status <> ? AND processing_status <> ?`, id, CaptureStatusRecording, ProcessingStatusProcessing)
	ok, err := rowsChanged(result, err, fmt.Sprintf("delete meeting %s", id))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("delete meeting %s: meeting changed; stop recording or wait for processing to finish", id)
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return nil, fmt.Errorf("commit delete meeting %s: %w", id, err)
	}
	return &meeting, nil
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
