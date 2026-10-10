package db

import (
	"context"
	"database/sql"
	"fmt"
)

// VideoFile is a fixed managed filename, never an external or user-supplied path.
const VideoFile = "screen.mov"
const VideoPartialFile = "screen.in-progress.mov"

type VideoUpdate struct {
	State         VideoState
	SourceType    *string
	File          *string
	StartSec      *float64
	EndSec        *float64
	Message       *string
	OriginHostSec *float64
	EndHostSec    *float64
}

func (d *DB) UpdateMeetingVideo(id string, update VideoUpdate) error {
	_, err := d.Conn.Exec(`UPDATE meetings SET video_state=?, video_source_type=COALESCE(?, video_source_type), video_file=CASE WHEN ? IN ('failed','cancelled','skipped') THEN NULL ELSE COALESCE(?,video_file) END, video_start_sec=COALESCE(?,video_start_sec), video_end_sec=?, video_message=?, video_origin_host_sec=COALESCE(?,video_origin_host_sec), video_end_host_sec=COALESCE(?,video_end_host_sec) WHERE id=?`,
		update.State, update.SourceType, update.State, update.File, update.StartSec, update.EndSec, update.Message, update.OriginHostSec, update.EndHostSec, id)
	return err
}

func (d *DB) UpdateAudioStart(id, source string, seconds float64) error {
	column := ""
	switch source {
	case "mic":
		column = "mic_start_host_sec"
	case "system":
		column = "system_start_host_sec"
	default:
		return fmt.Errorf("unknown audio source %q", source)
	}
	_, err := d.Conn.Exec(`UPDATE meetings SET `+column+`=COALESCE(`+column+`,?) WHERE id=?`, seconds, id)
	return err
}

func migrateMeetingVideo(ctx context.Context, conn *sql.Conn) error {
	const name = "meeting_screen_video"
	var applied bool
	if err := conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM migrations WHERE name=?)`, name).Scan(&applied); err != nil {
		return err
	}
	if applied {
		return nil
	}
	columns, err := tableColumns(ctx, conn, "meetings")
	if err != nil {
		return err
	}
	for _, column := range []struct{ name, definition string }{
		{"video_state", "TEXT NOT NULL DEFAULT 'off' CHECK (video_state IN ('off','selecting','cancelled','skipped','recording','ended','ready','failed','unfinished'))"},
		{"video_source_type", "TEXT CHECK (video_source_type IN ('window','display'))"},
		{"video_file", "TEXT CHECK (video_file IN ('screen.mov','screen.in-progress.mov'))"},
		{"video_start_sec", "REAL"}, {"video_end_sec", "REAL"}, {"video_message", "TEXT"},
		{"video_origin_host_sec", "REAL"}, {"video_end_host_sec", "REAL"}, {"mic_start_host_sec", "REAL"}, {"system_start_host_sec", "REAL"},
	} {
		if _, ok := columns[column.name]; ok {
			continue
		}
		if _, err := conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN `+column.name+` `+column.definition); err != nil {
			return fmt.Errorf("add %s: %w", column.name, err)
		}
	}
	_, err = conn.ExecContext(ctx, `INSERT INTO migrations(name) VALUES (?)`, name)
	return err
}

func (d *DB) UpdateVideoInterval(id string) error {
	_, err := d.Conn.Exec(`UPDATE meetings SET
    video_start_sec=CASE WHEN video_origin_host_sec IS NOT NULL AND (mic_start_host_sec IS NOT NULL OR system_start_host_sec IS NOT NULL)
      THEN max(0,video_origin_host_sec - CASE WHEN mic_start_host_sec IS NULL THEN system_start_host_sec WHEN system_start_host_sec IS NULL THEN mic_start_host_sec ELSE min(mic_start_host_sec,system_start_host_sec) END) ELSE NULL END,
    video_end_sec=CASE WHEN video_end_host_sec IS NOT NULL AND (mic_start_host_sec IS NOT NULL OR system_start_host_sec IS NOT NULL)
      THEN max(0,video_end_host_sec - CASE WHEN mic_start_host_sec IS NULL THEN system_start_host_sec WHEN system_start_host_sec IS NULL THEN mic_start_host_sec ELSE min(mic_start_host_sec,system_start_host_sec) END) ELSE NULL END WHERE id=?`, id)
	return err
}

// ListCompactableVideoMeetings returns Meetings with a finalized managed movie, newest first.
func (d *DB) ListCompactableVideoMeetings(limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(selectMeetingsSQL+` WHERE video_state IN ('ready','ended') AND video_file=? AND capture_status <> 'recording' ORDER BY started_at DESC LIMIT ?`, VideoFile, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMeetings(rows)
}

// HasActiveRecording reports a recording whose heartbeat is newer than cutoff.
func (d *DB) HasActiveRecording(cutoff string) (bool, error) {
	var count int
	err := d.Conn.QueryRow(`SELECT COUNT(*) FROM meetings WHERE capture_status='recording' AND capture_status_updated_at >= ?`, cutoff).Scan(&count)
	return count > 0, err
}

func (d *DB) ListInterruptedVideoMeetings(cutoff string, limit int) ([]Meeting, error) {
	rows, err := d.Conn.Query(selectMeetingsSQL+` WHERE (video_state='selecting' OR (video_state IN ('recording','ended','unfinished') AND video_file=?)) AND (capture_status <> 'recording' OR capture_status_updated_at < ?) ORDER BY started_at ASC LIMIT ?`, VideoPartialFile, cutoff, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMeetings(rows)
}
