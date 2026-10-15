package admin

import (
	"context"
	_ "embed"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed 001.sql
var migration string

//go:embed 002.sql
var lifecycleMigration string

//go:embed 003.sql
var selectedMigration string

//go:embed 004.sql
var meetingMigration string

//go:embed 005.sql
var readSurfaceMigration string

//go:embed 006.sql
var revocationMigration string

//go:embed 007.sql
var accountStateMigration string

//go:embed 008.sql
var deviceMigration string

//go:embed 009.sql
var clientDirectoryMigration string

//go:embed 010.sql
var backlogMigration string

//go:embed 011.sql
var summaryLimitMigration string

//go:embed 012.sql
var demoRemovalMigration string

//go:embed 013.sql
var syntheticRemovalMigration string

func Migrate(ctx context.Context, conn *pgx.Conn) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(74812001)`); err != nil {
		return err
	}
	if err = migrateVersion(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Provision runs only with separate administrator credentials, never at server startup.
func Provision(ctx context.Context, conn *pgx.Conn, password string) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic';
 SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1; SET LOCAL log_statement_sample_rate=0`); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_reader') THEN CREATE ROLE gappd_reader; END IF; END $$`)
	if err != nil {
		return err
	}
	if err = setPassword(ctx, tx, password); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `GRANT USAGE ON SCHEMA public TO gappd_reader; GRANT SELECT ON cloud_meetings, meeting_lifecycle, revoked_grants TO gappd_reader;
 GRANT EXECUTE ON FUNCTION cleanup_backlog() TO gappd_reader;
 ALTER ROLE gappd_reader SET default_transaction_read_only=on; ALTER ROLE gappd_reader SET statement_timeout='3s'`)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func setPassword(ctx context.Context, tx pgx.Tx, password string) error {
	if len(password) < 24 || strings.ContainsAny(password, "\x00\r\n") {
		return errors.New("invalid password")
	}
	// Role DDL cannot bind parameters. Force standard strings before quoting the literal.
	if _, err := tx.Exec(ctx, `SET LOCAL standard_conforming_strings=on`); err != nil {
		return err
	}
	literal := "'" + strings.ReplaceAll(password, "'", "''") + "'"
	_, err := tx.Exec(ctx, `ALTER ROLE gappd_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD `+literal)
	return err
}

func migrateVersion(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS cloud_migrations (version integer PRIMARY KEY)`); err != nil {
		return err
	}
	for index, sql := range []string{migration, lifecycleMigration, selectedMigration, meetingMigration, readSurfaceMigration, revocationMigration,
		accountStateMigration, deviceMigration, clientDirectoryMigration, backlogMigration, summaryLimitMigration, demoRemovalMigration, syntheticRemovalMigration} {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM cloud_migrations WHERE version=$1)`, index+1).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			if _, err := tx.Exec(ctx, sql); err != nil {
				return err
			}
		}
	}
	return nil
}
