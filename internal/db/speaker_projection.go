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

func validProjectionReason(reason SpeakerAssignmentReason) bool {
	switch reason {
	case SpeakerAssignmentReasonThresholdAssignment, SpeakerAssignmentReasonAmbiguousSupport,
		SpeakerAssignmentReasonInsufficientCoverage, SpeakerAssignmentReasonNoEvidence,
		SpeakerAssignmentReasonDominantFallback, SpeakerAssignmentReasonSingleTurnFallback:
		return true
	}
	return false
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
	Embeddings                 []SpeakerEmbedding
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

	meeting, applied, err := applySpeakerProjection(ctx, tx, input, assignments, provenanceJSON)
	if err != nil || !applied {
		return meeting, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("commit speaker projection: %w", err)
	}
	return meeting, true, nil
}

func validateProjection(input SpeakerProjectionCommit) (map[string]SpeakerProjectionAssignment, string, error) {
	if input.MeetingID == "" || input.ClaimToken == "" || len(input.Assignments) == 0 {
		return nil, "", fmt.Errorf("speaker projection requires meeting, claim, and assignments")
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
		if assignment.SegmentID == "" || duplicate || !validProjectionReason(assignment.Reason) ||
			assignment.Speaker != VisibleSpeakerOther && !numberedSpeaker.MatchString(string(assignment.Speaker)) ||
			confidence != nil && (math.IsNaN(*confidence) || math.IsInf(*confidence, 0) || *confidence < 0 || *confidence > 1) {
			return nil, "", fmt.Errorf("invalid speaker projection assignment for segment %q", assignment.SegmentID)
		}
		assignments[assignment.SegmentID] = assignment
	}
	return assignments, string(compact), nil
}

func updateProjectedSegments(ctx context.Context, tx *sql.Tx, segments []Segment, assignments map[string]SpeakerProjectionAssignment) (bool, bool, error) {
	changed, matched := false, 0
	for i := range segments {
		if segments[i].SpeakerSource == nil || *segments[i].SpeakerSource != SegmentSourceSystem {
			continue
		}
		assignment, ok := assignments[segments[i].ID]
		if !ok {
			return false, false, nil
		}
		matched++
		updated, err := applyProjectedSegment(ctx, tx, &segments[i], assignment)
		if err != nil {
			return false, false, err
		}
		changed = changed || updated
	}
	return changed, matched == len(assignments), nil
}

func getMeetingTx(ctx context.Context, tx *sql.Tx, id string) (*Meeting, error) {
	meeting, err := scanMeetingRow(tx.QueryRowContext(ctx, selectMeetingsSQL+` WHERE id=?`, id))
	return &meeting, err
}

func equalFloat(left, right *float64) bool {
	return left == nil && right == nil || left != nil && right != nil && *left == *right
}

func writeProjectedSegment(ctx context.Context, tx *sql.Tx, segment Segment, assignment SpeakerProjectionAssignment) error {
	result, err := tx.ExecContext(ctx, `UPDATE segments SET speaker=?,speaker_confidence=?,speaker_assignment_reason=?
 WHERE id=? AND meeting_id=? AND speaker_source=?`, string(assignment.Speaker), assignment.Confidence, assignment.Reason,
		segment.ID, segment.MeetingID, SegmentSourceSystem)
	updated, err := rowsChanged(result, err, "update projected segment")
	if err != nil {
		return err
	}
	if !updated {
		return fmt.Errorf("system segment %s changed during projection", segment.ID)
	}
	return nil
}

func applyProjectedSegment(ctx context.Context, tx *sql.Tx, segment *Segment, assignment SpeakerProjectionAssignment) (bool, error) {
	if segment.PersonID != nil {
		return false, nil
	}
	speaker := string(assignment.Speaker)
	if segment.Speaker == speaker && equalFloat(segment.SpeakerConfidence, assignment.Confidence) &&
		segment.SpeakerAssignmentReason != nil && *segment.SpeakerAssignmentReason == assignment.Reason {
		return false, nil
	}
	if err := writeProjectedSegment(ctx, tx, *segment, assignment); err != nil {
		return false, err
	}
	segment.Speaker, segment.SpeakerConfidence, segment.SpeakerAssignmentReason = speaker, assignment.Confidence, &assignment.Reason
	return true, nil
}
