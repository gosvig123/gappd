package db

import (
	"database/sql"
	"fmt"
)

type Segment struct {
	ID        string
	MeetingID string
	Start     float64
	End       float64
	Text      string
	Speaker   string
	CreatedAt string
}

const insertSegmentSQL = `INSERT INTO segments
	(id, meeting_id, start_sec, end_sec, text, speaker)
	VALUES (?, ?, ?, ?, ?, ?)`

const selectSegmentsSQL = `SELECT id, meeting_id, start_sec, end_sec,
	text, speaker, created_at
	FROM segments WHERE meeting_id = ? ORDER BY start_sec ASC`

const deleteSegmentsSQL = `DELETE FROM segments WHERE meeting_id = ?`

func (d *DB) InsertSegment(s *Segment) error {
	if s.ID == "" {
		id, err := newID()
		if err != nil {
			return err
		}
		s.ID = id
	}
	_, err := d.Conn.Exec(insertSegmentSQL,
		s.ID, s.MeetingID, s.Start, s.End, s.Text, s.Speaker)
	return err
}

func (d *DB) ReplaceSegments(meetingID string, segments []Segment) error {
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin replace segments: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(deleteSegmentsSQL, meetingID); err != nil {
		return fmt.Errorf("delete segments for meeting %s: %w", meetingID, err)
	}
	if err := insertSegmentsTx(tx, segments); err != nil {
		return err
	}
	return tx.Commit()
}

func replaceSegmentsTx(tx *sql.Tx, meetingID string, segments []Segment) error {
	if _, err := tx.Exec(deleteSegmentsSQL, meetingID); err != nil {
		return err
	}
	return insertSegmentsTx(tx, segments)
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
	_, err := stmt.Exec(segment.ID, segment.MeetingID, segment.Start, segment.End, segment.Text, segment.Speaker)
	if err != nil {
		return fmt.Errorf("insert segment %s: %w", segment.ID, err)
	}
	return nil
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
		if err := rows.Scan(&s.ID, &s.MeetingID, &s.Start,
			&s.End, &s.Text, &s.Speaker, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan segment: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
