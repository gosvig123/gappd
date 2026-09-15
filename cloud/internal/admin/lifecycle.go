package admin

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// BackfillDemo requires an operator-supported acceptance time, not fixture dates.
func BackfillDemo(ctx context.Context, conn *pgx.Conn, owner, accepted string) error {
	timestamp, err := legacyAcceptance(ctx, conn, owner, accepted)
	if err != nil {
		return err
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,74812002))`, owner); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO demo_lifecycle(id,owner_id,accepted_at,expires_at)
 SELECT id,owner_id,$2::timestamptz,$2::timestamptz+interval '720 hours' FROM meetings
 WHERE owner_id=$1 AND id=demo_meeting_id($1) ON CONFLICT DO NOTHING`, owner, timestamp)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func ProvisionCleanup(ctx context.Context, conn *pgx.Conn, password string) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = mutationRole(ctx, tx, "gappd_demo_cleanup", password); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, cleanupPolicy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

const cleanupPolicy = `
 GRANT USAGE ON SCHEMA public TO gappd_demo_cleanup;
 GRANT SELECT ON demo_lifecycle TO gappd_demo_cleanup;
 GRANT UPDATE(deleted_at) ON demo_lifecycle TO gappd_demo_cleanup;
 GRANT SELECT, DELETE ON meetings TO gappd_demo_cleanup;
 ALTER ROLE gappd_demo_cleanup SET statement_timeout='3s';
 DROP POLICY IF EXISTS cleanup_lifecycle ON demo_lifecycle;
 CREATE POLICY cleanup_lifecycle ON demo_lifecycle TO gappd_demo_cleanup
 USING (expires_at<=statement_timestamp()) WITH CHECK (expires_at<=statement_timestamp() AND deleted_at IS NOT NULL);
 DROP POLICY IF EXISTS cleanup_read ON meetings;
 CREATE POLICY cleanup_read ON meetings FOR SELECT TO gappd_demo_cleanup
 USING (id=demo_meeting_id(owner_id) AND EXISTS (SELECT FROM demo_lifecycle l
 WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id AND l.expires_at<=statement_timestamp()));
 DROP POLICY IF EXISTS cleanup_delete ON meetings;
 CREATE POLICY cleanup_delete ON meetings FOR DELETE TO gappd_demo_cleanup
 USING (id=demo_meeting_id(owner_id) AND EXISTS (SELECT FROM demo_lifecycle l
 WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id AND l.expires_at<=statement_timestamp() AND l.deleted_at IS NOT NULL));
`

func legacyAcceptance(ctx context.Context, conn *pgx.Conn, owner, accepted string) (time.Time, error) {
	timestamp, err := time.Parse(time.RFC3339, accepted)
	if err != nil || owner == "" || strings.TrimSpace(owner) != owner || len(owner) > 256 {
		return timestamp, errors.New("legacy owner and RFC3339 acceptance required")
	}
	var valid bool
	if err = conn.QueryRow(ctx, `SELECT $1::timestamptz<=clock_timestamp()`, timestamp).Scan(&valid); err != nil {
		return timestamp, err
	}
	if !valid {
		return timestamp, errors.New("future acceptance forbidden")
	}
	return timestamp, nil
}
