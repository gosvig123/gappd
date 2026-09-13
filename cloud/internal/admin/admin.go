package admin

import (
	"context"
	_ "embed"
	"errors"
	"strings"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
)

//go:embed 001.sql
var migration string

//go:embed 002.sql
var lifecycleMigration string

//go:embed 003.sql
var selectedMigration string

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
	_, err = tx.Exec(ctx, `GRANT USAGE ON SCHEMA public TO gappd_reader; GRANT SELECT ON meetings, demo_lifecycle TO gappd_reader;
 ALTER ROLE gappd_reader SET default_transaction_read_only=on; ALTER ROLE gappd_reader SET statement_timeout='3s'`)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func Seed(ctx context.Context, conn *pgx.Conn, owner string) error {
	if strings.TrimSpace(owner) != owner || owner == "" || len(owner) > 256 {
		return errors.New("invalid owner")
	}
	var id string
	err := conn.QueryRow(ctx, `INSERT INTO meetings VALUES ($1,$2,$3,$4,$5,$6,$6,true)
 ON CONFLICT (id) DO UPDATE SET id=excluded.id WHERE meetings.owner_id=excluded.owner_id RETURNING id::text`,
		service.DemoID, owner, "SYNTHETIC: Demo planning Meeting", "Synthetic participants agreed to review a fictional prototype.",
		"[00:00] Synthetic speaker: This is fabricated test data.\n[00:05] Synthetic speaker: Review the fictional prototype next week.", "2026-09-13T12:00:00Z").Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("demo already belongs to another owner")
	}
	return err
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
	for index, sql := range []string{migration, lifecycleMigration, selectedMigration} {
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
