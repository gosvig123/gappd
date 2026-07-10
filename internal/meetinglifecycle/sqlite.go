package meetinglifecycle

import (
	"context"
	"fmt"

	"github.com/gappd-dev/gappd/internal/db"
)

type meetingVersion struct {
	captureStatus       db.CaptureStatus
	captureUpdatedAt    string
	processingStatus    db.ProcessingStatus
	processingUpdatedAt string
}

func versionOf(meeting *db.Meeting) meetingVersion {
	return meetingVersion{
		captureStatus: meeting.CaptureStatus, captureUpdatedAt: meeting.CaptureStatusUpdatedAt,
		processingStatus: meeting.ProcessingStatus, processingUpdatedAt: meeting.ProcessingStatusUpdatedAt,
	}
}

func updateMeeting(ctx context.Context, store *db.DB, meeting *db.Meeting, version meetingVersion) (bool, error) {
	result, err := store.Conn.ExecContext(ctx, updateMeetingSQL, updateArgs(meeting, version)...)
	if err != nil {
		return false, fmt.Errorf("transition meeting %s: %w", meeting.ID, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("transition meeting %s rows affected: %w", meeting.ID, err)
	}
	return rows > 0, nil
}

func updateArgs(m *db.Meeting, v meetingVersion) []any {
	return []any{
		m.Title, m.EndedAt, m.CaptureStatus, m.CaptureStatusUpdatedAt, m.CaptureFailureMessage,
		m.ProcessingStatus, m.ProcessingStatusUpdatedAt, m.ProcessingFailureMessage,
		m.Transcript, m.Summary, m.ExtractionJSON, m.ID,
		v.captureStatus, v.captureUpdatedAt, v.processingStatus, v.processingUpdatedAt,
	}
}

const updateMeetingSQL = `UPDATE meetings SET title=?, ended_at=?,
	capture_status=?, capture_status_updated_at=?, capture_failure_message=?,
	processing_status=?, processing_status_updated_at=?, processing_failure_message=?,
	transcript=?, summary=?, extraction_json=?
	WHERE id=? AND capture_status=? AND capture_status_updated_at=?
	AND processing_status=? AND processing_status_updated_at=?`
