package db

import (
	"context"
	"database/sql"
	"fmt"
)

type lifecycleMigration struct {
	columns map[string]bool
}

type columnMigration struct {
	name string
	sql  string
}

var lifecycleColumns = []columnMigration{
	{"capture_status", `ALTER TABLE meetings ADD COLUMN capture_status TEXT NOT NULL DEFAULT 'recording' CHECK (capture_status IN ('recording', 'captured', 'failed'))`},
	{"capture_status_updated_at", `ALTER TABLE meetings ADD COLUMN capture_status_updated_at TEXT NOT NULL DEFAULT ''`},
	{"capture_failure_message", `ALTER TABLE meetings ADD COLUMN capture_failure_message TEXT`},
	{"processing_status", `ALTER TABLE meetings ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'not_started' CHECK (processing_status IN ('not_started', 'processing', 'completed', 'failed'))`},
	{"processing_status_updated_at", `ALTER TABLE meetings ADD COLUMN processing_status_updated_at TEXT NOT NULL DEFAULT ''`},
	{"processing_failure_message", `ALTER TABLE meetings ADD COLUMN processing_failure_message TEXT`},
	{"extraction_json", `ALTER TABLE meetings ADD COLUMN extraction_json TEXT`},
	{"language", `ALTER TABLE meetings ADD COLUMN language TEXT NOT NULL DEFAULT 'en_US'`},
}

func (d *DB) upgradeMeetingsLifecycle(ctx context.Context, conn *sql.Conn) error {
	columns, err := tableColumns(ctx, conn, "meetings")
	if err != nil {
		return err
	}
	migration := lifecycleMigration{columns: columns}
	if err := migration.addColumns(ctx, conn); err != nil {
		return err
	}
	return migration.backfill(ctx, conn)
}

func (m lifecycleMigration) addColumns(ctx context.Context, conn *sql.Conn) error {
	for _, column := range lifecycleColumns {
		if m.columns[column.name] {
			continue
		}
		if _, err := conn.ExecContext(ctx, column.sql); err != nil {
			return fmt.Errorf("add meetings.%s: %w", column.name, err)
		}
	}
	return nil
}

func (m lifecycleMigration) backfill(ctx context.Context, conn *sql.Conn) error {
	steps := []func(context.Context, *sql.Conn) error{
		m.backfillCaptureStatus, m.backfillCaptureUpdatedAt, m.backfillCaptureFailure,
		m.backfillProcessingStatus, m.backfillProcessingUpdatedAt, m.backfillProcessingFailure,
	}
	for _, step := range steps {
		if err := step(ctx, conn); err != nil {
			return err
		}
	}
	return nil
}

func (m lifecycleMigration) backfillCaptureStatus(ctx context.Context, conn *sql.Conn) error {
	status := m.legacyStatusExpr()
	query := fmt.Sprintf(captureStatusBackfillSQL, status, status, status, status)
	return m.execBackfill(ctx, conn, "capture_status", query, captureStatusBackfillWhere(status))
}

func (m lifecycleMigration) backfillCaptureUpdatedAt(ctx context.Context, conn *sql.Conn) error {
	updatedAt := m.legacyStatusUpdatedAtExpr()
	query := fmt.Sprintf(captureUpdatedAtBackfillSQL, updatedAt, updatedAt, updatedAt)
	return m.execBackfill(ctx, conn, "capture_status_updated_at", query, emptyColumnWhere("capture_status_updated_at"))
}

func (m lifecycleMigration) backfillCaptureFailure(ctx context.Context, conn *sql.Conn) error {
	status := m.legacyStatusExpr()
	failure := m.legacyFailureMessageExpr()
	query := fmt.Sprintf(captureFailureBackfillSQL, status, failure)
	return m.execBackfill(ctx, conn, "capture_failure_message", query, emptyColumnWhere("capture_failure_message"))
}

func (m lifecycleMigration) backfillProcessingStatus(ctx context.Context, conn *sql.Conn) error {
	status := m.legacyStatusExpr()
	query := fmt.Sprintf(processingStatusBackfillSQL, status, status, status)
	return m.execBackfill(ctx, conn, "processing_status", query, processingStatusBackfillWhere(status))
}

func (m lifecycleMigration) backfillProcessingUpdatedAt(ctx context.Context, conn *sql.Conn) error {
	updatedAt := m.legacyStatusUpdatedAtExpr()
	query := fmt.Sprintf(processingUpdatedAtBackfillSQL, updatedAt, updatedAt, updatedAt)
	return m.execBackfill(ctx, conn, "processing_status_updated_at", query, emptyColumnWhere("processing_status_updated_at"))
}

func (m lifecycleMigration) backfillProcessingFailure(ctx context.Context, conn *sql.Conn) error {
	status := m.legacyStatusExpr()
	failure := m.legacyFailureMessageExpr()
	query := fmt.Sprintf(processingFailureBackfillSQL, status, failure)
	return m.execBackfill(ctx, conn, "processing_failure_message", query, emptyColumnWhere("processing_failure_message"))
}

func (m lifecycleMigration) execBackfill(ctx context.Context, conn *sql.Conn, column, query, where string) error {
	if m.columns[column] {
		query += " WHERE " + where
	}
	if _, err := conn.ExecContext(ctx, query); err != nil {
		return fmt.Errorf("backfill meetings.%s: %w", column, err)
	}
	return nil
}

func (m lifecycleMigration) legacyStatusExpr() string {
	if m.columns["status"] {
		return "status"
	}
	return artifactStatusExpr
}

func (m lifecycleMigration) legacyStatusUpdatedAtExpr() string {
	if m.columns["status_updated_at"] {
		return "status_updated_at"
	}
	return artifactUpdatedAtExpr
}

func (m lifecycleMigration) legacyFailureMessageExpr() string {
	if m.columns["failure_message"] {
		return "failure_message"
	}
	return "NULL"
}

func emptyColumnWhere(column string) string {
	return column + " IS NULL OR " + column + " = ''"
}

func captureStatusBackfillWhere(status string) string {
	return emptyColumnWhere("capture_status") + fmt.Sprintf(" OR (capture_status = 'recording' AND %s <> 'recording')", status)
}

func processingStatusBackfillWhere(status string) string {
	return emptyColumnWhere("processing_status") + fmt.Sprintf(" OR (processing_status = 'not_started' AND %s IN ('processing', 'completed', 'failed'))", status)
}

func (d *DB) tableColumns(name string) (map[string]bool, error) {
	return tableColumns(context.Background(), d.Conn, name)
}

type tableInfoQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func tableColumns(ctx context.Context, queryer tableInfoQueryer, name string) (map[string]bool, error) {
	rows, err := queryer.QueryContext(ctx, `PRAGMA table_info(`+name+`)`)
	if err != nil {
		return nil, fmt.Errorf("table info %s: %w", name, err)
	}
	defer rows.Close()
	return scanTableColumns(rows, name)
}

func scanTableColumns(rows *sql.Rows, name string) (map[string]bool, error) {
	columns := map[string]bool{}
	for rows.Next() {
		columnName, err := scanColumnName(rows, name)
		if err != nil {
			return nil, err
		}
		columns[columnName] = true
	}
	return columns, rows.Err()
}

func scanColumnName(rows *sql.Rows, name string) (string, error) {
	var cid, notNull, pk int
	var columnName, columnType string
	var defaultValue any
	if err := rows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &pk); err != nil {
		return "", fmt.Errorf("scan table info %s: %w", name, err)
	}
	return columnName, nil
}
