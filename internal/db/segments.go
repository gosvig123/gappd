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

func (d *DB) InsertSegments(segments []Segment) error {
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(insertSegmentSQL)
	if err != nil {
		return fmt.Errorf("prepare: %w", err)
	}
	defer stmt.Close()
	for i := range segments {
		if segments[i].ID == "" {
			id, err := newID()
			if err != nil {
				return err
			}
			segments[i].ID = id
		}
		if _, err := stmt.Exec(segments[i].ID, segments[i].MeetingID,
			segments[i].Start, segments[i].End,
			segments[i].Text, segments[i].Speaker); err != nil {
			return fmt.Errorf("insert segment %s: %w", segments[i].ID, err)
		}
	}
	return tx.Commit()
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
