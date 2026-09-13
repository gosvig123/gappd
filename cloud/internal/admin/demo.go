package admin

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ProvisionDemo is an explicit private administrator action, never runtime setup.
func ProvisionDemo(ctx context.Context, conn *pgx.Conn, password string) error {
	if len(password) < 24 || strings.ContainsAny(password, "\x00\r\n") {
		return errors.New("invalid password")
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = demoRole(ctx, tx, password); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, demoPolicy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func demoRole(ctx context.Context, tx pgx.Tx, password string) error {
	_, err := tx.Exec(ctx, `SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic';
 SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1;
 SET LOCAL log_statement_sample_rate=0; SET LOCAL standard_conforming_strings=on`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_demo_writer')
 THEN CREATE ROLE gappd_demo_writer; END IF; END $$`)
	if err != nil {
		return err
	}
	literal := "'" + strings.ReplaceAll(password, "'", "''") + "'"
	_, err = tx.Exec(ctx, `ALTER ROLE gappd_demo_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
 NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD `+literal)
	return err
}

// INSERT policy constrains every writable byte. No UPDATE or DELETE privilege exists.
const demoPolicy = `
 GRANT USAGE ON SCHEMA public TO gappd_demo_writer;
 GRANT SELECT, INSERT ON meetings TO gappd_demo_writer;
 ALTER ROLE gappd_demo_writer SET statement_timeout='3s';
 DROP POLICY IF EXISTS synthetic_demo_insert ON meetings;
 CREATE POLICY synthetic_demo_insert ON meetings FOR INSERT TO gappd_demo_writer
 WITH CHECK (owner_id=current_setting('app.owner_id',true)
 AND title='SYNTHETIC: Desktop consent demo'
 AND summary='Fabricated participants approved a fictional demo.'
 AND transcript='[00:00] Synthetic speaker: No local Meeting data was read or uploaded.'
 AND started_at='2026-09-13T12:00:00Z' AND updated_at=started_at AND synthetic=true);
`
