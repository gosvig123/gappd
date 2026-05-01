package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type DB struct {
	Conn *sql.DB
}

const initBusyTimeoutMS = 5000

func Open(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	return &DB{Conn: conn}, nil
}

func (d *DB) Init() error {
	ctx := context.Background()
	conn, err := d.Conn.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire init connection: %w", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, fmt.Sprintf("PRAGMA busy_timeout = %d", initBusyTimeoutMS)); err != nil {
		return fmt.Errorf("set busy timeout: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable foreign keys: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return fmt.Errorf("begin init tx: %w", err)
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		_, _ = conn.ExecContext(ctx, "ROLLBACK")
	}()

	columns, err := tableColumns(ctx, conn, "meetings")
	if err != nil {
		return err
	}
	if len(columns) > 0 {
		if err := d.upgradeMeetingsLifecycle(ctx, conn); err != nil {
			return err
		}
	}
	_, err = conn.ExecContext(ctx, schema)
	if err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO meetings_fts(meetings_fts) VALUES ('rebuild')`); err != nil {
		return fmt.Errorf("rebuild meetings fts: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return fmt.Errorf("commit init tx: %w", err)
	}
	committed = true
	if _, err := conn.ExecContext(ctx, "PRAGMA journal_mode = WAL"); err != nil {
		return fmt.Errorf("set wal mode: %w", err)
	}
	return nil
}

func (d *DB) Close() error {
	return d.Conn.Close()
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generating uuid: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
