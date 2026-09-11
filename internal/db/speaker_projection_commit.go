package db

import (
	"context"
	"database/sql"
)

func applySpeakerProjection(ctx context.Context, tx *sql.Tx, input SpeakerProjectionCommit, assignments map[string]SpeakerProjectionAssignment, provenanceJSON string) (*Meeting, bool, error) {
	meeting, err := getMeetingTx(ctx, tx, input.MeetingID)
	if err != nil {
		return nil, false, err
	}
	if !projectionClaimCurrent(meeting, input) {
		return meeting, false, nil
	}
	segments, changed, exact, err := projectStoredSegments(ctx, tx, input.MeetingID, assignments)
	if err != nil || !exact {
		return meeting, false, err
	}
	meeting, applied, err := persistSpeakerProjection(ctx, tx, input, FormatTranscript(segments), changed, provenanceJSON)
	if err != nil || !applied {
		return meeting, false, err
	}
	if err := replaceSpeakerEmbeddings(tx, input.MeetingID, input.Embeddings); err != nil {
		return nil, false, err
	}
	return meeting, true, nil
}

func projectionClaimCurrent(meeting *Meeting, input SpeakerProjectionCommit) bool {
	return meeting.ProcessingStatus == ProcessingStatusProcessing && meeting.ProcessingClaimToken != nil &&
		*meeting.ProcessingClaimToken == input.ClaimToken && meeting.DiarizationState == DiarizationStateProcessing &&
		meeting.TranscriptRevision == input.CapturedTranscriptRevision
}

func projectStoredSegments(ctx context.Context, tx *sql.Tx, meetingID string, assignments map[string]SpeakerProjectionAssignment) ([]Segment, bool, bool, error) {
	rows, err := tx.QueryContext(ctx, selectSegmentsSQL, meetingID)
	if err != nil {
		return nil, false, false, err
	}
	segments, err := scanSegments(rows)
	rows.Close()
	if err != nil {
		return nil, false, false, err
	}
	if err := reconcileSpeakerIdentities(tx, meetingID, segments, assignments); err != nil {
		return nil, false, false, err
	}
	changed, exact, err := updateProjectedSegments(ctx, tx, segments, assignments)
	return segments, changed, exact, err
}

var commitProjectionSQL = `UPDATE meetings SET
		transcript=?, transcript_revision=transcript_revision+?,
		diarization_state=?, diarization_error=NULL, diarization_json=?,
		processing_status=CASE WHEN ? OR NOT (` + ProcessingArtifactsCurrentSQL("?", "transcript_revision+?") + `)
			THEN ? ELSE ? END,
		processing_status_updated_at=?, processing_failure_message=NULL,
		processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND processing_status=? AND processing_claim_token=?
		AND diarization_state=? AND transcript_revision=?`

func persistSpeakerProjection(ctx context.Context, tx *sql.Tx, input SpeakerProjectionCommit, transcript string, changed bool, provenanceJSON string) (*Meeting, bool, error) {
	result, err := tx.ExecContext(ctx, commitProjectionSQL, transcript, changed, DiarizationStateCompleted, provenanceJSON,
		changed, transcript, changed, ProcessingStatusPending, ProcessingStatusCompleted, stamp(input.CompletedAt),
		input.MeetingID, ProcessingStatusProcessing, input.ClaimToken, DiarizationStateProcessing,
		input.CapturedTranscriptRevision)
	applied, err := rowsChanged(result, err, "commit speaker projection")
	if err != nil || !applied {
		return nil, false, err
	}
	meeting, err := getMeetingTx(ctx, tx, input.MeetingID)
	return meeting, err == nil, err
}
