package db

import (
	"context"
	"database/sql"
	"fmt"
)

func migrateMeetingsSearchTrigger(ctx context.Context, conn *sql.Conn) error {
	const name = "meetings_search_changed_values"
	var applied bool
	if err := conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM migrations WHERE name=?)`, name).Scan(&applied); err != nil {
		return fmt.Errorf("inspect meetings search migration: %w", err)
	}
	if applied {
		return nil
	}
	if _, err := conn.ExecContext(ctx, `DROP TRIGGER IF EXISTS meetings_au`); err != nil {
		return fmt.Errorf("drop meetings search update trigger: %w", err)
	}
	// Reuse the canonical trigger definition; all other schema objects already exist.
	if _, err := conn.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("upgrade meetings search update trigger: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO migrations(name) VALUES (?)`, name); err != nil {
		return fmt.Errorf("record meetings search migration: %w", err)
	}
	return nil
}
