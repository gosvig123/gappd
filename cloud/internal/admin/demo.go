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
	if err = mutationRole(ctx, tx, "gappd_demo_writer", password); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, demoPolicy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func mutationRole(ctx context.Context, tx pgx.Tx, role, password string) error {
	if len(password) < 24 || strings.ContainsAny(password, "\x00\r\n") {
		return errors.New("invalid password")
	}
	if role != "gappd_demo_writer" && role != "gappd_demo_cleanup" && role != "gappd_meeting_writer" && role != "gappd_meeting_cleanup" {
		return errors.New("invalid role")
	}
	_, err := tx.Exec(ctx, `SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic';
 SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1;
 SET LOCAL log_statement_sample_rate=0; SET LOCAL standard_conforming_strings=on`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='`+role+`')
 THEN CREATE ROLE `+role+`; END IF; END $$`)
	if err != nil {
		return err
	}
	literal := "'" + strings.ReplaceAll(password, "'", "''") + "'"
	_, err = tx.Exec(ctx, `ALTER ROLE `+role+` LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
 NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD `+literal)
	return err
}

// Payload and identity policies constrain the separate synthetic mutation role.
const demoPolicy = `
 GRANT USAGE ON SCHEMA public TO gappd_demo_writer;
 GRANT SELECT, INSERT, DELETE ON meetings TO gappd_demo_writer;
 GRANT SELECT, INSERT ON demo_lifecycle TO gappd_demo_writer;
 GRANT UPDATE(deleted_at) ON demo_lifecycle TO gappd_demo_writer;
 DROP POLICY IF EXISTS demo_mutation_read ON meetings;
 CREATE POLICY demo_mutation_read ON meetings FOR SELECT TO gappd_demo_writer
 USING (owner_id=current_setting('app.owner_id',true) AND id=demo_meeting_id(owner_id));
 DROP POLICY IF EXISTS demo_delete ON meetings;
 CREATE POLICY demo_delete ON meetings FOR DELETE TO gappd_demo_writer
 USING (owner_id=current_setting('app.owner_id',true) AND id=demo_meeting_id(owner_id)
 AND EXISTS (SELECT FROM demo_lifecycle l WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id AND l.deleted_at IS NOT NULL));
 ALTER ROLE gappd_demo_writer SET statement_timeout='3s';
 DROP POLICY IF EXISTS synthetic_demo_insert ON meetings;
 CREATE POLICY synthetic_demo_insert ON meetings FOR INSERT TO gappd_demo_writer
 WITH CHECK (owner_id=current_setting('app.owner_id',true) AND id=demo_meeting_id(owner_id)
 AND title='SYNTHETIC: Desktop consent demo'
 AND summary='Fabricated participants approved a fictional demo.'
 AND transcript='[00:00] Synthetic speaker: No local Meeting data was read or uploaded.'
 AND started_at='2026-09-13T12:00:00Z' AND updated_at=started_at AND synthetic=true);
`
