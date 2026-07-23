package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"
)

const diarizationBackupSuffix = ".pre-diarization.bak"
const diarizationBackupMaxAge = 7 * 24 * time.Hour

var diarizationColumns = map[string][]columnMigration{
	"meetings": {
		{"transcript_revision", `ALTER TABLE meetings ADD COLUMN transcript_revision INTEGER NOT NULL DEFAULT 0`},
		{"summary_transcript_revision", `ALTER TABLE meetings ADD COLUMN summary_transcript_revision INTEGER NOT NULL DEFAULT 0`},
		{"diarization_state", `ALTER TABLE meetings ADD COLUMN diarization_state TEXT NOT NULL DEFAULT 'not_requested' CHECK (diarization_state IN ('not_requested','not_applicable','pending','processing','completed','degraded'))`},
		{"diarization_error", `ALTER TABLE meetings ADD COLUMN diarization_error TEXT`},
		{"diarization_json", `ALTER TABLE meetings ADD COLUMN diarization_json TEXT`},
	},
	"segments": {
		{"speaker_source", `ALTER TABLE segments ADD COLUMN speaker_source TEXT`},
		{"speaker_confidence", `ALTER TABLE segments ADD COLUMN speaker_confidence REAL`},
		{"speaker_assignment_reason", `ALTER TABLE segments ADD COLUMN speaker_assignment_reason TEXT`},
		{"speaker_group_start_sec", `ALTER TABLE segments ADD COLUMN speaker_group_start_sec REAL`},
		{"speaker_group_end_sec", `ALTER TABLE segments ADD COLUMN speaker_group_end_sec REAL`},
	},
}

func needsDiarizationMigration(ctx context.Context, conn *sql.Conn) (bool, error) {
	for table, required := range diarizationColumns {
		columns, err := tableColumns(ctx, conn, table)
		if err != nil {
			return false, err
		}
		for _, column := range required {
			if len(columns) > 0 && !columns[column.name] {
				return true, nil
			}
		}
	}
	return false, nil
}

func migrateDiarizationSchema(ctx context.Context, conn *sql.Conn) error {
	for table, columns := range diarizationColumns {
		existing, err := tableColumns(ctx, conn, table)
		if err != nil {
			return err
		}
		for _, column := range columns {
			if len(existing) == 0 || existing[column.name] {
				continue
			}
			if _, err := conn.ExecContext(ctx, column.sql); err != nil {
				return fmt.Errorf("add %s.%s: %w", table, column.name, err)
			}
		}
	}
	return nil
}

func (d *DB) backupBeforeDiarization(ctx context.Context, conn *sql.Conn) error {
	if d.path == "" || strings.Contains(d.path, ":memory:") {
		return nil
	}
	backupPath := d.path + diarizationBackupSuffix
	if _, err := os.Stat(backupPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect diarization backup: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `VACUUM INTO ?`, backupPath); err != nil {
		_ = os.Remove(backupPath)
		return fmt.Errorf("backup before diarization migration: %w", err)
	}
	return nil
}

func (d *DB) cleanupDiarizationBackup(ctx context.Context, conn *sql.Conn) error {
	if d.path == "" || strings.Contains(d.path, ":memory:") {
		return nil
	}
	backupPath := d.path + diarizationBackupSuffix
	info, err := os.Stat(backupPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect diarization backup: %w", err)
	}
	if time.Since(info.ModTime()) < diarizationBackupMaxAge {
		return nil
	}
	healthy, err := diarizationSchemaHealthy(ctx, conn)
	if err != nil {
		return err
	}
	if healthy {
		if err := os.Remove(backupPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove diarization backup: %w", err)
		}
	}
	return nil
}

func diarizationSchemaHealthy(ctx context.Context, conn *sql.Conn) (bool, error) {
	migrationNeeded, err := needsDiarizationMigration(ctx, conn)
	if err != nil || migrationNeeded {
		return false, err
	}
	var result string
	if err := conn.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&result); err != nil {
		return false, fmt.Errorf("check migrated database: %w", err)
	}
	return result == "ok", nil
}
