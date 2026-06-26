package db

import (
	"database/sql"
	"fmt"
)

type CaptureStatus string
type ProcessingStatus string

const (
	CaptureStatusRecording CaptureStatus = "recording"
	CaptureStatusCaptured  CaptureStatus = "captured"
	CaptureStatusFailed    CaptureStatus = "failed"

	ProcessingStatusNotStarted ProcessingStatus = "not_started"
	ProcessingStatusProcessing ProcessingStatus = "processing"
	ProcessingStatusCompleted  ProcessingStatus = "completed"
	ProcessingStatusFailed     ProcessingStatus = "failed"
)

type Meeting struct {
	ID                        string
	Title                     string
	StartedAt                 string
	EndedAt                   *string
	CaptureStatus             CaptureStatus
	CaptureStatusUpdatedAt    string
	CaptureFailureMessage     *string
	ProcessingStatus          ProcessingStatus
	ProcessingStatusUpdatedAt string
	ProcessingFailureMessage  *string
	AudioPath                 *string
	Transcript                *string
	Summary                   *string
	ExtractionJSON            *string
	Tags                      string
	Source                    string
	CreatedAt                 string
}

const selectMeetingsSQL = `SELECT id, title, started_at, ended_at, capture_status, capture_status_updated_at, capture_failure_message,
	processing_status, processing_status_updated_at, processing_failure_message,
	audio_path, transcript, summary, extraction_json, tags, source, created_at
	FROM meetings`

func (d *DB) CreateMeeting(m *Meeting) error {
	if m.ID == "" {
		id, err := newID()
		if err != nil {
			return err
		}
		m.ID = id
	}
	_, err := d.Conn.Exec(
		`INSERT INTO meetings (
			id, title, started_at, ended_at, status, status_updated_at, failure_message,
			capture_status, capture_status_updated_at, capture_failure_message,
			processing_status, processing_status_updated_at, processing_failure_message,
			audio_path, transcript, summary, extraction_json, tags, source
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Title, m.StartedAt, m.EndedAt, legacyStatusFor(*m), legacyStatusUpdatedAtFor(*m), legacyFailureMessageFor(*m),
		m.CaptureStatus, m.CaptureStatusUpdatedAt, m.CaptureFailureMessage,
		m.ProcessingStatus, m.ProcessingStatusUpdatedAt, m.ProcessingFailureMessage,
		m.AudioPath, m.Transcript, m.Summary, m.ExtractionJSON, m.Tags, m.Source,
	)
	if err != nil {
		return fmt.Errorf("create meeting: %w", err)
	}
	return nil
}

func (d *DB) UpdateMeeting(m *Meeting) error {
	_, err := d.Conn.Exec(
		`UPDATE meetings SET title=?, started_at=?, ended_at=?, status=?, status_updated_at=?, failure_message=?,
		 capture_status=?, capture_status_updated_at=?, capture_failure_message=?, processing_status=?,
		 processing_status_updated_at=?, processing_failure_message=?, audio_path=?, transcript=?, summary=?,
		 extraction_json=?, tags=?, source=? WHERE id=?`,
		m.Title, m.StartedAt, m.EndedAt, legacyStatusFor(*m), legacyStatusUpdatedAtFor(*m), legacyFailureMessageFor(*m),
		m.CaptureStatus, m.CaptureStatusUpdatedAt, m.CaptureFailureMessage, m.ProcessingStatus,
		m.ProcessingStatusUpdatedAt, m.ProcessingFailureMessage, m.AudioPath, m.Transcript, m.Summary,
		m.ExtractionJSON, m.Tags, m.Source, m.ID,
	)
	if err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}
	return nil
}

func (d *DB) UpdateRecordingHeartbeat(id, updatedAt string) error {
	_, err := d.Conn.Exec(`UPDATE meetings SET capture_status_updated_at = ? WHERE id = ? AND capture_status = ?`, updatedAt, id, CaptureStatusRecording)
	if err != nil {
		return fmt.Errorf("update recording heartbeat: %w", err)
	}
	return nil
}

func (d *DB) GetMeeting(id string) (*Meeting, error) {
	row := d.Conn.QueryRow(
		`SELECT id, title, started_at, ended_at, capture_status, capture_status_updated_at, capture_failure_message,
		 processing_status, processing_status_updated_at, processing_failure_message,
		 audio_path, transcript, summary, extraction_json, tags, source, created_at
		 FROM meetings WHERE id=?`, id,
	)
	m := &Meeting{}
	err := row.Scan(
		&m.ID, &m.Title, &m.StartedAt, &m.EndedAt, &m.CaptureStatus, &m.CaptureStatusUpdatedAt, &m.CaptureFailureMessage,
		&m.ProcessingStatus, &m.ProcessingStatusUpdatedAt, &m.ProcessingFailureMessage,
		&m.AudioPath, &m.Transcript, &m.Summary, &m.ExtractionJSON, &m.Tags, &m.Source, &m.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get meeting: %w", err)
	}
	return m, nil
}

func (d *DB) ListMeetings(limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(selectMeetingsSQL+` ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list meetings: %w", err)
	}
	defer rows.Close()
	return scanMeetings(rows)
}

func (d *DB) ListStaleRecordingMeetings(cutoff string, limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(selectMeetingsSQL+` WHERE capture_status = ? AND capture_status_updated_at < ? ORDER BY started_at ASC LIMIT ?`, CaptureStatusRecording, cutoff, limit)
	if err != nil {
		return nil, fmt.Errorf("list stale recording meetings: %w", err)
	}
	defer rows.Close()
	return scanMeetings(rows)
}

func (d *DB) ClaimStaleRecordingForProcessing(id, cutoff, endedAt string) (bool, error) {
	result, err := d.Conn.Exec(claimStaleRecordingSQL, endedAt, CaptureStatusCaptured, endedAt,
		ProcessingStatusProcessing, endedAt, id, CaptureStatusRecording, cutoff)
	return changed(result, err, "claim stale recording for processing")
}

func (d *DB) FailStaleRecording(id, cutoff, endedAt, message string) (bool, error) {
	result, err := d.Conn.Exec(failStaleRecordingSQL, endedAt, CaptureStatusFailed, endedAt, message,
		id, CaptureStatusRecording, cutoff)
	return changed(result, err, "fail stale recording")
}

const claimStaleRecordingSQL = `UPDATE meetings SET ended_at = COALESCE(ended_at, ?),
	capture_status = ?, capture_status_updated_at = ?, capture_failure_message = NULL,
	processing_status = ?, processing_status_updated_at = ?, processing_failure_message = NULL
	WHERE id = ? AND capture_status = ? AND capture_status_updated_at < ?`

const failStaleRecordingSQL = `UPDATE meetings SET ended_at = COALESCE(ended_at, ?),
	capture_status = ?, capture_status_updated_at = ?, capture_failure_message = ?
	WHERE id = ? AND capture_status = ? AND capture_status_updated_at < ?`

func changed(result sql.Result, err error, operation string) (bool, error) {
	if err != nil {
		return false, fmt.Errorf("%s: %w", operation, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("%s rows affected: %w", operation, err)
	}
	return rows > 0, nil
}

func scanMeetings(rows *sql.Rows) ([]Meeting, error) {
	var meetings []Meeting
	for rows.Next() {
		var m Meeting
		err := rows.Scan(
			&m.ID, &m.Title, &m.StartedAt, &m.EndedAt, &m.CaptureStatus, &m.CaptureStatusUpdatedAt, &m.CaptureFailureMessage,
			&m.ProcessingStatus, &m.ProcessingStatusUpdatedAt, &m.ProcessingFailureMessage,
			&m.AudioPath, &m.Transcript, &m.Summary, &m.ExtractionJSON, &m.Tags, &m.Source, &m.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan meeting: %w", err)
		}
		meetings = append(meetings, m)
	}
	return meetings, rows.Err()
}
