package meetinglifecycle

import (
	"context"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

// ChangeLanguage sets a captured Meeting's language and queues it for transcription again.
// The old segments stay in the database until the new transcript replaces them; the app hides them while the Meeting waits.
// Speaker labeling runs again when it was requested, because it works from the transcript phrases.
// It is not applied while the Meeting is recording or processing.
func (w Module) ChangeLanguage(ctx context.Context, id, language string, at time.Time) (Result, error) {
	return w.updateDiarization(ctx, id, `UPDATE meetings SET language=?, transcript=NULL,
		diarization_state=CASE WHEN diarization_state=? THEN diarization_state ELSE ? END,
		diarization_error=NULL, diarization_json=NULL,
		processing_status=?, processing_status_updated_at=?, processing_failure_message=NULL,
		processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND language<>? AND capture_status=? AND processing_status<>?
		AND audio_path IS NOT NULL AND trim(audio_path)<>''`,
		language, db.DiarizationStateNotRequested, db.DiarizationStatePending,
		db.ProcessingStatusPending, timestamp(at),
		id, language, db.CaptureStatusCaptured, db.ProcessingStatusProcessing)
}
