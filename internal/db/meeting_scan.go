package db

import (
	"database/sql"
	"fmt"
)

func scanMeetings(rows *sql.Rows) ([]Meeting, error) {
	var meetings []Meeting
	for rows.Next() {
		meeting, err := scanMeeting(rows)
		if err != nil {
			return nil, err
		}
		meetings = append(meetings, meeting)
	}
	return meetings, rows.Err()
}

type rowScanner interface {
	Scan(...any) error
}

func scanMeeting(row *sql.Rows) (Meeting, error) { return scanMeetingRow(row) }

func scanMeetingRow(row rowScanner) (Meeting, error) {
	var m Meeting
	err := row.Scan(
		&m.ID, &m.Title, &m.StartedAt, &m.EndedAt, &m.CaptureStatus, &m.CaptureStatusUpdatedAt, &m.CaptureFailureMessage,
		&m.ProcessingStatus, &m.ProcessingStatusUpdatedAt, &m.ProcessingFailureMessage,
		&m.ProcessingClaimToken, &m.ProcessingClaimExpiresAt, &m.AudioPath, &m.Transcript, &m.TranscriptRevision,
		&m.Summary, &m.SummaryTranscriptRevision, &m.ExtractionJSON, &m.Language, &m.Tags, &m.Source, &m.CreatedAt,
	)
	if err != nil {
		return Meeting{}, fmt.Errorf("scan meeting: %w", err)
	}
	return m, nil
}

func scanMeetingListEntries(rows *sql.Rows) ([]MeetingListEntry, error) {
	var entries []MeetingListEntry
	for rows.Next() {
		entry, err := scanMeetingListEntry(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func scanMeetingListEntry(rows *sql.Rows) (MeetingListEntry, error) {
	var entry MeetingListEntry
	err := rows.Scan(
		&entry.ID, &entry.Title, &entry.StartedAt, &entry.EndedAt, &entry.CaptureStatus, &entry.CaptureStatusUpdatedAt, &entry.CaptureFailureMessage,
		&entry.ProcessingStatus, &entry.ProcessingStatusUpdatedAt, &entry.ProcessingFailureMessage,
		&entry.ProcessingClaimToken, &entry.ProcessingClaimExpiresAt, &entry.AudioPath,
		&entry.HasTranscript, &entry.TranscriptRevision, &entry.HasSummary, &entry.SummaryTranscriptRevision,
		&entry.Language, &entry.Tags, &entry.Source, &entry.CreatedAt,
	)
	if err != nil {
		return MeetingListEntry{}, fmt.Errorf("scan meeting list entry: %w", err)
	}
	return entry, nil
}
