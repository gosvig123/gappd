package service

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DeleteDemo never accepts a caller-supplied Meeting identity.
func DeleteDemo(ctx context.Context, pool *pgxpool.Pool, owner string) error {
	if owner == "" {
		return errors.New("owner required")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if err = lockDemo(ctx, tx, owner); err != nil {
		return err
	}
	if err = markDemo(ctx, tx, owner); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM meetings WHERE id=$1 AND owner_id=$2`, DemoMeetingID(owner), owner); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func lockDemo(ctx context.Context, tx pgx.Tx, owner string) error {
	if _, err := tx.Exec(ctx, `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,74812002))`, owner)
	return err
}

func markDemo(ctx context.Context, tx pgx.Tx, owner string) error {
	_, err := tx.Exec(ctx, `INSERT INTO demo_lifecycle(id,owner_id,deleted_at) VALUES ($1,$2,statement_timestamp())
 ON CONFLICT (owner_id,id) DO UPDATE SET deleted_at=coalesce(demo_lifecycle.deleted_at,excluded.deleted_at)`, DemoMeetingID(owner), owner)
	return err
}
