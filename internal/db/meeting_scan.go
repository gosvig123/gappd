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

func scanMeeting(rows *sql.Rows) (Meeting, error) {
	var m Meeting
	err := rows.Scan(
		&m.ID, &m.Title, &m.StartedAt, &m.EndedAt, &m.CaptureStatus, &m.CaptureStatusUpdatedAt, &m.CaptureFailureMessage,
		&m.ProcessingStatus, &m.ProcessingStatusUpdatedAt, &m.ProcessingFailureMessage,
		&m.ProcessingClaimToken, &m.ProcessingClaimExpiresAt, &m.AudioPath, &m.Transcript, &m.Summary, &m.ExtractionJSON, &m.Language, &m.Tags, &m.Source, &m.CreatedAt,
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
		&entry.ProcessingClaimToken, &entry.ProcessingClaimExpiresAt, &entry.AudioPath, &entry.HasTranscript, &entry.HasSummary, &entry.Language, &entry.Tags, &entry.Source, &entry.CreatedAt,
	)
	if err != nil {
		return MeetingListEntry{}, fmt.Errorf("scan meeting list entry: %w", err)
	}
	return entry, nil
}
