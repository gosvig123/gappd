package db

import (
	"database/sql"
	"fmt"
)

const (
	operationMarkCaptureFailed        = "mark meeting capture failed"
	operationMarkCaptured             = "mark meeting captured"
	operationMarkProcessingStarted    = "mark meeting processing"
	operationMarkProcessingFailed     = "mark meeting processing failed"
	operationSaveTranscript           = "save transcript"
	operationCompleteProcessing       = "complete meeting processing"
	operationFailProcessingTranscript = "save failed meeting processing transcript"
	operationClaimStaleRecording      = "claim stale recording for processing"
	operationFailStaleRecording       = "fail stale recording"
)

type MeetingProcessingCompletion struct {
	Title          string
	Transcript     string
	Summary        string
	ExtractionJSON string
	At             string
}

func (d *DB) MarkCaptureFailed(meeting *Meeting, at string, failure error) error {
	return d.applyMeetingLifecycle(meeting, operationMarkCaptureFailed, func(l MeetingLifecycle) { l.CaptureFailed(at, failure) })
}

func (d *DB) MarkCaptured(meeting *Meeting, at string) error {
	return d.applyMeetingLifecycle(meeting, operationMarkCaptured, func(l MeetingLifecycle) { l.Captured(at) })
}

func (d *DB) MarkProcessingStarted(meeting *Meeting, at string) error {
	return d.applyMeetingLifecycle(meeting, operationMarkProcessingStarted, func(l MeetingLifecycle) { l.ProcessingStarted(at) })
}

func (d *DB) MarkProcessingFailed(meeting *Meeting, at string, failure error) error {
	return d.applyMeetingLifecycle(meeting, operationMarkProcessingFailed, func(l MeetingLifecycle) { l.ProcessingFailed(at, failure) })
}

func (d *DB) SaveTranscript(meeting *Meeting, transcript, at string) error {
	return d.applyMeetingLifecycle(meeting, operationSaveTranscript, func(l MeetingLifecycle) { l.TranscriptSaved(transcript, at) })
}

func (d *DB) CompleteProcessing(meeting *Meeting, completion MeetingProcessingCompletion) error {
	return d.applyMeetingLifecycle(meeting, operationCompleteProcessing, func(l MeetingLifecycle) {
		l.ProcessingCompleted(completion.Title, completion.Transcript, completion.Summary, completion.ExtractionJSON, completion.At)
	})
}

func (d *DB) FailProcessingWithTranscript(meeting *Meeting, transcript, at string, failure error) error {
	return d.applyMeetingLifecycle(meeting, operationFailProcessingTranscript, func(l MeetingLifecycle) {
		l.EnhancementFailed(transcript, at, failure)
	})
}

func (d *DB) ClaimStaleRecordingForProcessing(meeting *Meeting, cutoff, endedAt string) (bool, error) {
	ok, err := d.change(claimStaleRecordingSQL, operationClaimStaleRecording, endedAt, CaptureStatusCaptured, endedAt,
		ProcessingStatusProcessing, endedAt, meeting.ID, CaptureStatusRecording, cutoff)
	if !ok || err != nil {
		return ok, err
	}
	LifecycleFor(meeting).Captured(endedAt)
	return true, nil
}

func (d *DB) FailStaleRecording(meeting *Meeting, cutoff, endedAt string, failure error) (bool, error) {
	ok, err := d.change(failStaleRecordingSQL, operationFailStaleRecording, endedAt, CaptureStatusFailed, endedAt,
		failure.Error(), meeting.ID, CaptureStatusRecording, cutoff)
	if !ok || err != nil {
		return ok, err
	}
	LifecycleFor(meeting).CaptureFailed(endedAt, failure)
	return true, nil
}

func (d *DB) applyMeetingLifecycle(meeting *Meeting, operation string, apply func(MeetingLifecycle)) error {
	updated := *meeting
	apply(LifecycleFor(&updated))
	if err := d.UpdateMeeting(&updated); err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	*meeting = updated
	return nil
}

func (d *DB) change(query, operation string, args ...any) (bool, error) {
	result, err := d.Conn.Exec(query, args...)
	return changed(result, err, operation)
}

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

const claimStaleRecordingSQL = `UPDATE meetings SET ended_at = COALESCE(ended_at, ?),
	capture_status = ?, capture_status_updated_at = ?, capture_failure_message = NULL,
	processing_status = ?, processing_status_updated_at = ?, processing_failure_message = NULL
	WHERE id = ? AND capture_status = ? AND capture_status_updated_at < ?`

const failStaleRecordingSQL = `UPDATE meetings SET ended_at = COALESCE(ended_at, ?),
	capture_status = ?, capture_status_updated_at = ?, capture_failure_message = ?
	WHERE id = ? AND capture_status = ? AND capture_status_updated_at < ?`
