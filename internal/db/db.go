package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

type DB struct {
	Conn *sql.DB
	path string
}

const sqliteBusyTimeoutMS = 5000

func Open(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", sqliteConnectionString(path))
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	return &DB{Conn: conn, path: path}, nil
}

func (d *DB) Init() error {
	ctx := context.Background()
	conn, err := d.Conn.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire init connection: %w", err)
	}
	defer conn.Close()
	if err := prepareInitConnection(ctx, conn); err != nil {
		return err
	}
	migrationStartup, err := needsDiarizationMigration(ctx, conn)
	if err != nil {
		return err
	}
	if migrationStartup {
		if err := d.backupBeforeDiarization(ctx, conn); err != nil {
			return err
		}
	}
	if err := d.initializeSchema(ctx, conn); err != nil {
		return err
	}
	if err := finishInitConnection(ctx, conn); err != nil {
		return err
	}
	if !migrationStartup {
		_ = d.cleanupDiarizationBackup(ctx, conn)
	}
	return nil
}

func finishInitConnection(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable foreign keys: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "PRAGMA journal_mode = WAL"); err != nil {
		return fmt.Errorf("set wal mode: %w", err)
	}
	return nil
}

func sqliteConnectionString(path string) string {
	return fmt.Sprintf("%s?_pragma=busy_timeout(%d)&_pragma=foreign_keys(1)", path, sqliteBusyTimeoutMS)
}

func prepareInitConnection(ctx context.Context, conn *sql.Conn) error {
	// SQLite requires foreign keys off before rebuilding a referenced table.
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		return fmt.Errorf("disable foreign keys for migration: %w", err)
	}
	return nil
}

// Every command opens the store, and most only read. A current schema needs no write, so the
// first pass takes no write lock and cannot block or break other processes. Only when a migration
// must write and another process holds or moved the database does the pass run again under the
// write lock, which serializes concurrent migrations.
func (d *DB) initializeSchema(ctx context.Context, conn *sql.Conn) error {
	err := d.initializeSchemaIn(ctx, conn, "BEGIN")
	if isBusy(err) {
		err = d.initializeSchemaIn(ctx, conn, "BEGIN IMMEDIATE")
	}
	return err
}

func isBusy(err error) bool {
	var sqliteErr *sqlite.Error
	return errors.As(err, &sqliteErr) && sqliteErr.Code()&0xff == sqlite3.SQLITE_BUSY
}

func (d *DB) initializeSchemaIn(ctx context.Context, conn *sql.Conn, begin string) (err error) {
	if _, err = conn.ExecContext(ctx, begin); err != nil {
		return fmt.Errorf("begin init tx: %w", err)
	}
	defer func() {
		if err != nil {
			_, _ = conn.ExecContext(ctx, "ROLLBACK")
		}
	}()
	if err = d.migrateMeetings(ctx, conn); err != nil {
		return err
	}
	if err = migrateDiarizationSchema(ctx, conn); err != nil {
		return err
	}
	if err = installSchema(ctx, conn); err != nil {
		return err
	}
	if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
		return fmt.Errorf("commit init tx: %w", err)
	}
	return nil
}

func installSchema(ctx context.Context, conn *sql.Conn) error {
	if err := migrateVoiceEvidence(ctx, conn); err != nil {
		return err
	}
	searchExists, err := keepMeetingsSearch(ctx, conn)
	if err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	if err := migrateMeetingVideo(ctx, conn); err != nil {
		return err
	}
	if err := migrateMeetingTitleSource(ctx, conn); err != nil {
		return err
	}
	if err := migrateMeetingsSearchTrigger(ctx, conn); err != nil {
		return err
	}
	if searchExists {
		return nil
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO meetings_fts(meetings_fts) VALUES ('rebuild')`); err != nil {
		return fmt.Errorf("rebuild meetings fts: %w", err)
	}
	return nil
}

func (d *DB) migrateMeetings(ctx context.Context, conn *sql.Conn) error {
	columns, err := tableColumns(ctx, conn, "meetings")
	if err != nil || len(columns) == 0 {
		return err
	}
	if err := d.upgradeMeetingsLifecycle(ctx, conn); err != nil {
		return err
	}
	return rebuildMeetingsQueue(ctx, conn)
}

func (d *DB) Close() error { return d.Conn.Close() }

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generating uuid: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
