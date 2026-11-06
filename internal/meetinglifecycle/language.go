package meetinglifecycle

import (
	"context"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

// ChangeLanguage sets a captured Meeting's language and queues it for transcription again.
// It removes the old transcript, its segments and speaker names, so nothing in the old language
// shows while the Meeting waits. The transcript revision moves on, so the old notes show as updating.
// Speaker labeling runs again when it was requested, because it works from the transcript phrases.
// The same language applies only to retry a run that failed without a transcript.
// It is not applied while the Meeting is recording or processing.
func (w Module) ChangeLanguage(ctx context.Context, id, language string, at time.Time) (Result, error) {
	applied, err := w.changeLanguage(ctx, id, language, at)
	if err != nil {
		return Result{}, fmt.Errorf("change meeting %s language: %w", id, err)
	}
	meeting, err := w.store.GetMeeting(id)
	return Result{Meeting: meeting, Applied: applied}, err
}

func (w Module) changeLanguage(ctx context.Context, id, language string, at time.Time) (bool, error) {
	tx, err := w.store.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE meetings SET language=?, transcript=NULL, transcript_revision=transcript_revision+1,
		diarization_state=CASE WHEN diarization_state=? THEN diarization_state ELSE ? END,
		diarization_error=NULL, diarization_json=NULL, extraction_json=NULL,
		processing_status=?, processing_status_updated_at=?, processing_failure_message=NULL,
		processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND (language<>? OR (processing_status=? AND transcript IS NULL)) AND capture_status=? AND processing_status<>?
		AND audio_path IS NOT NULL AND trim(audio_path)<>''`,
		language, db.DiarizationStateNotRequested, db.DiarizationStatePending,
		db.ProcessingStatusPending, timestamp(at),
		id, language, db.ProcessingStatusFailed, db.CaptureStatusCaptured, db.ProcessingStatusProcessing)
	if err != nil {
		return false, err
	}
	if rows, err := result.RowsAffected(); err != nil || rows == 0 {
		return false, err
	}
	// Speaker names go with the old transcript; a kept 'cleared' identity row would block voice recognition.
	for _, query := range []string{`DELETE FROM meeting_speakers WHERE meeting_id=?`, `DELETE FROM speaker_identity_state WHERE meeting_id=?`, `DELETE FROM segments WHERE meeting_id=?`} {
		if _, err := tx.ExecContext(ctx, query, id); err != nil {
			return false, err
		}
	}
	return true, tx.Commit()
}
