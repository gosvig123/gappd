package db

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/meetinglang"
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
	Language                  string
	Tags                      string
	Source                    string
	CreatedAt                 string
}

type MeetingListEntry struct {
	Meeting
	HasTranscript bool
	HasSummary    bool
}

const selectMeetingsSQL = `SELECT id, title, started_at, ended_at, capture_status, capture_status_updated_at, capture_failure_message,
	processing_status, processing_status_updated_at, processing_failure_message,
	audio_path, transcript, summary, extraction_json, language, tags, source, created_at
	FROM meetings`

const selectMeetingListEntriesSQL = `SELECT id, title, started_at, ended_at, capture_status, capture_status_updated_at, capture_failure_message,
	processing_status, processing_status_updated_at, processing_failure_message,
	audio_path, transcript IS NOT NULL, summary IS NOT NULL, language, tags, source, created_at
	FROM meetings`

func (d *DB) CreateMeeting(m *Meeting) error {
	m.Language = meetinglang.Normalize(m.Language)
	if m.ID == "" {
		id, err := newID()
		if err != nil {
			return err
		}
		m.ID = id
	}
	_, err := d.Conn.Exec(
		`INSERT INTO meetings (
			id, title, started_at, ended_at,
			capture_status, capture_status_updated_at, capture_failure_message,
			processing_status, processing_status_updated_at, processing_failure_message,
			audio_path, transcript, summary, extraction_json, language, tags, source
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Title, m.StartedAt, m.EndedAt,
		m.CaptureStatus, m.CaptureStatusUpdatedAt, m.CaptureFailureMessage,
		m.ProcessingStatus, m.ProcessingStatusUpdatedAt, m.ProcessingFailureMessage,
		m.AudioPath, m.Transcript, m.Summary, m.ExtractionJSON, m.Language, m.Tags, m.Source,
	)
	if err != nil {
		return fmt.Errorf("create meeting: %w", err)
	}
	return nil
}

func (d *DB) GetMeeting(id string) (*Meeting, error) {
	row := d.Conn.QueryRow(
		`SELECT id, title, started_at, ended_at, capture_status, capture_status_updated_at, capture_failure_message,
		 processing_status, processing_status_updated_at, processing_failure_message,
		 audio_path, transcript, summary, extraction_json, language, tags, source, created_at
		 FROM meetings WHERE id=?`, id,
	)
	m := &Meeting{}
	err := row.Scan(
		&m.ID, &m.Title, &m.StartedAt, &m.EndedAt, &m.CaptureStatus, &m.CaptureStatusUpdatedAt, &m.CaptureFailureMessage,
		&m.ProcessingStatus, &m.ProcessingStatusUpdatedAt, &m.ProcessingFailureMessage,
		&m.AudioPath, &m.Transcript, &m.Summary, &m.ExtractionJSON, &m.Language, &m.Tags, &m.Source, &m.CreatedAt,
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

func (d *DB) ListMeetingEntries(limit int) ([]MeetingListEntry, error) {
	rows, err := d.Conn.Query(selectMeetingListEntriesSQL+` ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list meeting entries: %w", err)
	}
	defer rows.Close()
	return scanMeetingListEntries(rows)
}

func (d *DB) ListStaleRecordingMeetings(cutoff string, limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(selectMeetingsSQL+` WHERE capture_status = ? AND capture_status_updated_at < ? ORDER BY started_at ASC LIMIT ?`, CaptureStatusRecording, cutoff, limit)
	if err != nil {
		return nil, fmt.Errorf("list stale recording meetings: %w", err)
	}
	defer rows.Close()
	return scanMeetings(rows)
}
