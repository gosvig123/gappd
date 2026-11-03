package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// keepMeetingsSearch reports whether meetings_fts exists with the current tokenizer. An index
// built before stemming is dropped, so the schema recreates it and installSchema rebuilds it:
// "transcribers" then matches "transcriber", like the cloud's English text search.
func keepMeetingsSearch(ctx context.Context, conn *sql.Conn) (bool, error) {
	var definition string
	err := conn.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type='table' AND name='meetings_fts'`).Scan(&definition)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect meetings fts: %w", err)
	}
	if strings.Contains(definition, "porter") {
		return true, nil
	}
	if _, err := conn.ExecContext(ctx, `DROP TABLE meetings_fts`); err != nil {
		return false, fmt.Errorf("drop unstemmed meetings fts: %w", err)
	}
	return false, nil
}
