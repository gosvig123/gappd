package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type QueueStage string

const (
	QueueStageTranscription QueueStage = "transcription"
	QueueStageDiarization   QueueStage = "diarization"
	QueueStageSummarization QueueStage = "summarization"
	QueueStageNone          QueueStage = "none"
	QueueStageRepair        QueueStage = "repair"
)

type ProcessingClaim struct {
	Meeting   Meeting
	Token     string
	Stage     QueueStage
	ExpiresAt time.Time
}

func DeriveQueueStage(m Meeting) QueueStage {
	if !filledArtifact(m.Transcript) {
		if filledArtifact(m.Summary) || filledArtifact(m.ExtractionJSON) {
			return QueueStageRepair
		}
		return QueueStageTranscription
	}
	if m.DiarizationState == DiarizationStatePending {
		return QueueStageDiarization
	}
	if diarizationTerminal(m.DiarizationState) && (!filledArtifact(m.Summary) || !filledArtifact(m.ExtractionJSON) ||
		m.SummaryTranscriptRevision != m.TranscriptRevision) {
		return QueueStageSummarization
	}
	return QueueStageNone
}

func filledArtifact(value *string) bool {
	return value != nil && strings.TrimSpace(*value) != ""
}

func diarizationTerminal(state DiarizationState) bool {
	return state == "" || state == DiarizationStateNotRequested || state == DiarizationStateNotApplicable ||
		state == DiarizationStateCompleted || state == DiarizationStateDegraded
}

func (d *DB) ClaimNext(ctx context.Context, stage QueueStage, now time.Time, ttl time.Duration, excluded []string) (*ProcessingClaim, error) {
	token, err := newID()
	if err != nil {
		return nil, err
	}
	expires := now.UTC().Add(ttl)
	query, args := claimStatement(stage, token, now.UTC(), expires, excluded)
	meeting, err := scanClaimRow(d.Conn.QueryRowContext(ctx, query, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim processing meeting: %w", err)
	}
	return &ProcessingClaim{Meeting: *meeting, Token: token, Stage: stage, ExpiresAt: expires}, nil
}

func claimStatement(stage QueueStage, token string, now, expires time.Time, excluded []string) (string, []any) {
	condition := `transcript IS NULL OR trim(transcript)=''`
	conditionArgs := []any{}
	switch stage {
	case QueueStageDiarization:
		condition = `transcript IS NOT NULL AND trim(transcript)<>'' AND diarization_state IN (?,?)`
		conditionArgs = append(conditionArgs, DiarizationStatePending, DiarizationStateProcessing)
	case QueueStageSummarization:
		condition = `transcript IS NOT NULL AND trim(transcript)<>'' AND diarization_state IN (?,?,?,?) AND
			(summary IS NULL OR trim(summary)='' OR extraction_json IS NULL OR trim(extraction_json)='' OR summary_transcript_revision<>transcript_revision)`
		conditionArgs = append(conditionArgs, DiarizationStateNotRequested, DiarizationStateNotApplicable, DiarizationStateCompleted, DiarizationStateDegraded)
	}
	staleUnclaimedAt := now.Add(-3 * expires.Sub(now))
	subquery := `SELECT id FROM meetings WHERE capture_status=? AND (` + condition + `) AND
		(processing_status=? OR (processing_status=? AND ((processing_claim_token IS NULL AND processing_status_updated_at<=?)
		OR (processing_claim_token IS NOT NULL AND (processing_claim_expires_at IS NULL OR processing_claim_expires_at<=?)))))`
	args := []any{token, stamp(expires), ProcessingStatusProcessing, stamp(now), CaptureStatusCaptured}
	args = append(args, conditionArgs...)
	args = append(args, ProcessingStatusPending, ProcessingStatusProcessing, stamp(staleUnclaimedAt), stamp(now))
	if len(excluded) > 0 {
		subquery += ` AND id NOT IN (` + strings.TrimSuffix(strings.Repeat("?,", len(excluded)), ",") + `)`
		for _, id := range excluded {
			args = append(args, id)
		}
	}
	subquery += ` ORDER BY started_at ASC, created_at ASC LIMIT 1`
	query := `UPDATE meetings SET processing_claim_token=?, processing_claim_expires_at=?, processing_status=?,
		processing_status_updated_at=?, processing_failure_message=NULL WHERE id=(` + subquery + `) RETURNING ` + meetingColumns
	return query, args
}

const meetingColumns = `id,title,started_at,ended_at,capture_status,capture_status_updated_at,capture_failure_message,
	processing_status,processing_status_updated_at,processing_failure_message,processing_claim_token,processing_claim_expires_at,
	audio_path,transcript,transcript_revision,summary,summary_transcript_revision,extraction_json,
	diarization_state,diarization_error,diarization_json,language,tags,source,created_at`

func scanClaimRow(row *sql.Row) (*Meeting, error) {
	meeting, err := scanMeetingRow(row)
	return &meeting, err
}

func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000000000Z") }
