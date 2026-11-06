package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// migrateMeetingTitleSource adds title_source to databases made before it. Fresh databases
// get it from schema.sql.
func migrateMeetingTitleSource(ctx context.Context, conn *sql.Conn) error {
	columns, err := tableColumns(ctx, conn, "meetings")
	if err != nil {
		return err
	}
	if _, ok := columns["title_source"]; ok {
		return nil
	}
	if _, err := conn.ExecContext(ctx, `ALTER TABLE meetings ADD COLUMN title_source TEXT NOT NULL DEFAULT '' CHECK (title_source IN ('', 'calendar'))`); err != nil {
		return fmt.Errorf("add title_source: %w", err)
	}
	return nil
}

func (d *DB) SetMeetingTitle(ctx context.Context, id, title, source string) error {
	result, err := d.Conn.ExecContext(ctx, `UPDATE meetings SET title=?, title_source=? WHERE id=?`, title, source, id)
	if err != nil {
		return fmt.Errorf("set meeting title: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil || rows == 0 {
		return fmt.Errorf("set meeting title: %w", errors.Join(err, sql.ErrNoRows))
	}
	return nil
}
