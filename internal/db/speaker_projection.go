package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"time"
)

type VisibleSpeaker string

const (
	VisibleSpeakerOther              VisibleSpeaker = SpeakerOther
	maxProjectionProvenanceJSONBytes                = 4 << 10
)

var numberedSpeaker = regexp.MustCompile(`^Speaker [1-9][0-9]*$`)

var projectionReasons = map[SpeakerAssignmentReason]struct{}{
	SpeakerAssignmentReasonThresholdAssignment:  {},
	SpeakerAssignmentReasonAmbiguousSupport:     {},
	SpeakerAssignmentReasonInsufficientCoverage: {},
	SpeakerAssignmentReasonNoEvidence:           {},
	SpeakerAssignmentReasonDominantFallback:     {},
	SpeakerAssignmentReasonSingleTurnFallback:   {},
}

type SpeakerProjectionAssignment struct {
	SegmentID  string
	Speaker    VisibleSpeaker
	Confidence *float64
	Reason     SpeakerAssignmentReason
}

type SpeakerProjectionCommit struct {
	MeetingID                  string
	ClaimToken                 string
	CapturedTranscriptRevision int
	Assignments                []SpeakerProjectionAssignment
	ProvenanceJSON             string
	CompletedAt                time.Time
}

func (d *DB) CommitSpeakerProjection(ctx context.Context, input SpeakerProjectionCommit) (*Meeting, bool, error) {
	assignments, provenanceJSON, err := validateProjection(input)
	if err != nil {
		return nil, false, err
	}
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("begin speaker projection: %w", err)
	}
	defer tx.Rollback()

	meeting, err := getMeetingTx(ctx, tx, input.MeetingID)
	if err != nil {
		return nil, false, err
	}
	if !projectionClaimMatches(meeting, input) {
		return meeting, false, nil
	}
	segments, err := getSegmentsTx(ctx, tx, input.MeetingID)
	if err != nil {
		return nil, false, err
	}
	if !exactSystemAssignments(segments, assignments) {
		return meeting, false, nil
	}
	changed, err := updateProjectedSegments(ctx, tx, segments, assignments)
	if err != nil {
		return nil, false, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE meetings SET
		transcript=?, transcript_revision=transcript_revision+?,
		diarization_state=?, diarization_error=NULL, diarization_json=?,
		processing_status=?, processing_status_updated_at=?, processing_failure_message=NULL,
		processing_claim_token=NULL, processing_claim_expires_at=NULL
		WHERE id=? AND processing_status=? AND processing_claim_token=?
		AND diarization_state=? AND transcript_revision=?`,
		FormatTranscript(segments), boolInt(changed), DiarizationStateCompleted, provenanceJSON,
		ProcessingStatusPending, stamp(input.CompletedAt), input.MeetingID, ProcessingStatusProcessing,
		input.ClaimToken, DiarizationStateProcessing, input.CapturedTranscriptRevision)
	applied, err := rowsChanged(result, err, "commit speaker projection")
	if err != nil || !applied {
		return meeting, false, err
	}
	meeting, err = getMeetingTx(ctx, tx, input.MeetingID)
	if err != nil {
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("commit speaker projection: %w", err)
	}
	return meeting, true, nil
}

func validateProjection(input SpeakerProjectionCommit) (map[string]SpeakerProjectionAssignment, string, error) {
	if input.MeetingID == "" || input.ClaimToken == "" {
		return nil, "", fmt.Errorf("speaker projection requires meeting and claim")
	}
	if len(input.Assignments) == 0 {
		return nil, "", fmt.Errorf("speaker projection requires assignments")
	}
	if len(input.ProvenanceJSON) > maxProjectionProvenanceJSONBytes {
		return nil, "", fmt.Errorf("speaker projection provenance exceeds %d bytes", maxProjectionProvenanceJSONBytes)
	}
	var provenance map[string]json.RawMessage
	if err := json.Unmarshal([]byte(input.ProvenanceJSON), &provenance); err != nil || provenance == nil {
		return nil, "", fmt.Errorf("speaker projection provenance must be a JSON object")
	}
	compact, _ := json.Marshal(provenance)
	assignments := make(map[string]SpeakerProjectionAssignment, len(input.Assignments))
	for _, assignment := range input.Assignments {
		_, duplicate := assignments[assignment.SegmentID]
		confidence := assignment.Confidence
		_, validReason := projectionReasons[assignment.Reason]
		if assignment.SegmentID == "" || duplicate || !validReason ||
			assignment.Speaker != VisibleSpeakerOther && !numberedSpeaker.MatchString(string(assignment.Speaker)) ||
			confidence != nil && (math.IsNaN(*confidence) || math.IsInf(*confidence, 0) || *confidence < 0 || *confidence > 1) {
			return nil, "", fmt.Errorf("invalid speaker projection assignment for segment %q", assignment.SegmentID)
		}
		assignments[assignment.SegmentID] = assignment
	}
	return assignments, string(compact), nil
}

func projectionClaimMatches(meeting *Meeting, input SpeakerProjectionCommit) bool {
	return meeting.ProcessingStatus == ProcessingStatusProcessing && meeting.ProcessingClaimToken != nil &&
		*meeting.ProcessingClaimToken == input.ClaimToken && meeting.DiarizationState == DiarizationStateProcessing &&
		meeting.TranscriptRevision == input.CapturedTranscriptRevision
}

func exactSystemAssignments(segments []Segment, assignments map[string]SpeakerProjectionAssignment) bool {
	matched := 0
	for _, segment := range segments {
		if segment.SpeakerSource != nil && *segment.SpeakerSource == SegmentSourceSystem {
			if _, ok := assignments[segment.ID]; !ok {
				return false
			}
			matched++
		}
	}
	return matched == len(assignments)
}

func updateProjectedSegments(ctx context.Context, tx *sql.Tx, segments []Segment, assignments map[string]SpeakerProjectionAssignment) (bool, error) {
	changed := false
	for i := range segments {
		assignment, ok := assignments[segments[i].ID]
		if !ok {
			continue
		}
		speaker := string(assignment.Speaker)
		if segments[i].Speaker == speaker && equalFloat(segments[i].SpeakerConfidence, assignment.Confidence) &&
			segments[i].SpeakerAssignmentReason != nil && *segments[i].SpeakerAssignmentReason == assignment.Reason {
			continue
		}
		result, err := tx.ExecContext(ctx, `UPDATE segments SET speaker=?,speaker_confidence=?,speaker_assignment_reason=?
			WHERE id=? AND meeting_id=? AND speaker_source=?`, speaker, assignment.Confidence, assignment.Reason,
			segments[i].ID, segments[i].MeetingID, SegmentSourceSystem)
		updated, err := rowsChanged(result, err, "update projected segment")
		if err != nil {
			return false, err
		}
		if !updated {
			return false, fmt.Errorf("system segment %s changed during projection", segments[i].ID)
		}
		segments[i].Speaker = speaker
		segments[i].SpeakerConfidence = assignment.Confidence
		segments[i].SpeakerAssignmentReason = &assignment.Reason
		changed = true
	}
	return changed, nil
}

func getMeetingTx(ctx context.Context, tx *sql.Tx, id string) (*Meeting, error) {
	meeting, err := scanMeetingRow(tx.QueryRowContext(ctx, selectMeetingsSQL+` WHERE id=?`, id))
	return &meeting, err
}

func getSegmentsTx(ctx context.Context, tx *sql.Tx, meetingID string) ([]Segment, error) {
	rows, err := tx.QueryContext(ctx, selectSegmentsSQL, meetingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSegments(rows)
}

func equalFloat(left, right *float64) bool {
	return left == nil && right == nil || left != nil && right != nil && *left == *right
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
