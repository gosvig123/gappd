package db

import (
	"database/sql"
	"fmt"
	"strings"
)

type SegmentSource string
type SpeakerAssignmentReason string

const (
	SegmentSourceMicrophone SegmentSource = "microphone"
	SegmentSourceSystem     SegmentSource = "system"

	SpeakerYou   = "You"
	SpeakerOther = "Other"

	SpeakerAssignmentReasonMicrophone               SpeakerAssignmentReason = "microphone"
	SpeakerAssignmentReasonPendingSystemAttribution SpeakerAssignmentReason = "pending_system_attribution"
	SpeakerAssignmentReasonThresholdAssignment      SpeakerAssignmentReason = "threshold_assignment"
	SpeakerAssignmentReasonAmbiguousSupport         SpeakerAssignmentReason = "ambiguous_support"
	SpeakerAssignmentReasonInsufficientCoverage     SpeakerAssignmentReason = "insufficient_coverage"
	SpeakerAssignmentReasonNoEvidence               SpeakerAssignmentReason = "no_evidence"
	SpeakerAssignmentReasonDominantFallback         SpeakerAssignmentReason = "dominant_fallback"
	SpeakerAssignmentReasonSingleTurnFallback       SpeakerAssignmentReason = "single_turn_fallback"
)

type Segment struct {
	ID                      string
	MeetingID               string
	Start                   float64
	End                     float64
	Text                    string
	Speaker                 string
	SpeakerKey              string
	PersonID                *string
	SpeakerSource           *SegmentSource
	SpeakerConfidence       *float64
	SpeakerAssignmentReason *SpeakerAssignmentReason
	SpeakerGroupStart       *float64
	SpeakerGroupEnd         *float64
	CreatedAt               string
}

const insertSegmentSQL = `INSERT INTO segments
	(id, meeting_id, start_sec, end_sec, text, speaker, speaker_source, speaker_confidence, speaker_assignment_reason,
	 speaker_group_start_sec, speaker_group_end_sec)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const selectSegmentsSQL = `SELECT s.id, s.meeting_id, s.start_sec, s.end_sec,
    s.text, COALESCE(p.name, s.speaker), s.speaker_source, s.speaker_confidence,
    s.speaker_assignment_reason, s.speaker_group_start_sec, s.speaker_group_end_sec,
    s.created_at, s.speaker, ms.person_id
    FROM segments s LEFT JOIN meeting_speakers ms ON ms.meeting_id=s.meeting_id AND ms.speaker_key=s.speaker
    LEFT JOIN people p ON p.id=ms.person_id WHERE s.meeting_id=? ORDER BY s.start_sec ASC`

const deleteSegmentsSQL = `DELETE FROM segments WHERE meeting_id = ?`

func (d *DB) InsertSegment(s *Segment) error {
	if s.ID == "" {
		id, err := newID()
		if err != nil {
			return err
		}
		s.ID = id
	}
	tx, err := d.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(insertSegmentSQL, s.ID, s.MeetingID, s.Start, s.End, s.Text, s.RawSpeaker(),
		s.SpeakerSource, s.SpeakerConfidence, s.SpeakerAssignmentReason, s.SpeakerGroupStart, s.SpeakerGroupEnd); err != nil {
		return err
	}
	if err := incrementTranscriptRevision(tx, s.MeetingID); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) ReplaceSegments(meetingID string, segments []Segment) error {
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin replace segments: %w", err)
	}
	defer tx.Rollback()
	if err := replaceSegmentsTx(tx, meetingID, segments); err != nil {
		return fmt.Errorf("replace segments for meeting %s: %w", meetingID, err)
	}
	return tx.Commit()
}

func replaceSegmentsTx(tx *sql.Tx, meetingID string, segments []Segment) error {
	if _, err := tx.Exec(`DELETE FROM meeting_speakers WHERE meeting_id=?`, meetingID); err != nil {
		return err
	}
	if _, err := tx.Exec(deleteSegmentsSQL, meetingID); err != nil {
		return err
	}
	if err := insertSegmentsTx(tx, segments); err != nil {
		return err
	}
	return incrementTranscriptRevision(tx, meetingID)
}

func incrementTranscriptRevision(tx *sql.Tx, meetingID string) error {
	_, err := tx.Exec(`UPDATE meetings SET transcript_revision=transcript_revision+1 WHERE id=?`, meetingID)
	return err
}

func insertSegmentsTx(tx *sql.Tx, segments []Segment) error {
	stmt, err := tx.Prepare(insertSegmentSQL)
	if err != nil {
		return fmt.Errorf("prepare insert segments: %w", err)
	}
	defer stmt.Close()
	for i := range segments {
		if err := insertSegmentRow(stmt, &segments[i]); err != nil {
			return err
		}
	}
	return nil
}

func insertSegmentRow(stmt *sql.Stmt, segment *Segment) error {
	if segment.ID == "" {
		id, err := newID()
		if err != nil {
			return err
		}
		segment.ID = id
	}
	_, err := stmt.Exec(segment.ID, segment.MeetingID, segment.Start, segment.End, segment.Text, segment.RawSpeaker(),
		segment.SpeakerSource, segment.SpeakerConfidence, segment.SpeakerAssignmentReason, segment.SpeakerGroupStart, segment.SpeakerGroupEnd)
	if err != nil {
		return fmt.Errorf("insert segment %s: %w", segment.ID, err)
	}
	return nil
}

func FormatTranscript(segments []Segment) string {
	var b strings.Builder
	for _, segment := range segments {
		fmt.Fprintf(&b, "[%s] %s\n", segment.Speaker, segment.Text)
	}
	return b.String()
}

func (d *DB) GetSegments(meetingID string) ([]Segment, error) {
	rows, err := d.Conn.Query(selectSegmentsSQL, meetingID)
	if err != nil {
		return nil, fmt.Errorf("query segments: %w", err)
	}
	defer rows.Close()
	return scanSegments(rows)
}

func scanSegments(rows *sql.Rows) ([]Segment, error) {
	var out []Segment
	for rows.Next() {
		var s Segment
		if err := rows.Scan(&s.ID, &s.MeetingID, &s.Start, &s.End, &s.Text, &s.Speaker,
			&s.SpeakerSource, &s.SpeakerConfidence, &s.SpeakerAssignmentReason,
			&s.SpeakerGroupStart, &s.SpeakerGroupEnd, &s.CreatedAt, &s.SpeakerKey, &s.PersonID); err != nil {
			return nil, fmt.Errorf("scan segment: %w", err)
		}
		if s.PersonID == nil {
			s.SpeakerKey = ""
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RawSpeaker returns the stable recording-local key, independent of a person label.
func (segment Segment) RawSpeaker() string {
	if segment.SpeakerKey != "" {
		return segment.SpeakerKey
	}
	return segment.Speaker
}
