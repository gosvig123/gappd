package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// CleanupDemo removes at most 100 expired copies per invocation. Scheduling is external.
func CleanupDemo(ctx context.Context, conn *pgx.Conn) (int64, error) {
	var safe bool
	err := conn.QueryRow(ctx, `SELECT current_user='gappd_demo_cleanup' AND NOT rolsuper AND NOT rolbypassrls
 AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member=pg_roles.oid)
 AND NOT EXISTS (SELECT FROM pg_class WHERE relname IN ('meetings','demo_lifecycle') AND relowner=pg_roles.oid)
 FROM pg_roles WHERE rolname=current_user`).Scan(&safe)
	if err != nil || !safe {
		return 0, errors.New("isolated cleanup role required")
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	count, err := cleanupBatch(ctx, tx)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

func cleanupBatch(ctx context.Context, tx pgx.Tx) (int64, error) {
	// Select only remaining content, so old markers cannot starve the next batch.
	_, err := tx.Exec(ctx, `WITH candidates AS MATERIALIZED (
 SELECT l.owner_id,l.id FROM demo_lifecycle l JOIN meetings m USING(owner_id,id)
 WHERE l.expires_at<=statement_timestamp() ORDER BY l.expires_at,l.id LIMIT 100 FOR UPDATE OF l SKIP LOCKED
 ), marked AS (
 UPDATE demo_lifecycle l SET deleted_at=coalesce(l.deleted_at,statement_timestamp()) FROM candidates c
 WHERE l.owner_id=c.owner_id AND l.id=c.id RETURNING l.owner_id,l.id
 ) SELECT count(*) FROM marked`)
	if err != nil {
		return 0, err
	}
	// A separate statement sees the markers written above; both statements commit atomically.
	deleted, err := tx.Exec(ctx, `DELETE FROM meetings WHERE (owner_id,id) IN (
 SELECT m.owner_id,m.id FROM meetings m JOIN demo_lifecycle l USING(owner_id,id)
 WHERE l.expires_at<=statement_timestamp() AND l.deleted_at IS NOT NULL
 ORDER BY l.expires_at,l.id LIMIT 100)`)
	return deleted.RowsAffected(), err
}
