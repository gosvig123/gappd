package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DemoMeetingID is account-specific and never reuses the administrator-seeded demo.
func DemoMeetingID(owner string) string {
	sum := sha256.Sum256([]byte("gappd-synthetic-upload-v1:" + owner))
	sum[6] = (sum[6] & 15) | 128
	sum[8] = (sum[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

func demoHandler(pool *pgxpool.Pool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Read even unknown-length/chunked requests. No caller content is accepted.
		body, err := io.ReadAll(io.LimitReader(r.Body, 1))
		if err != nil || len(body) != 0 {
			http.Error(w, "request body forbidden", http.StatusBadRequest)
			return
		}
		owner, _ := r.Context().Value(ownerKey{}).(string)
		id, err := CreateDemo(r.Context(), pool, owner)
		if err != nil {
			http.Error(w, "demo unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "accepted", "subject": owner})
	})
}

func CreateDemo(ctx context.Context, pool *pgxpool.Pool, owner string) (string, error) {
	if owner == "" {
		return "", errors.New("owner required")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		return "", err
	}
	id := DemoMeetingID(owner)
	if err = insertDemo(ctx, tx, owner, id); err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

func insertDemo(ctx context.Context, tx pgx.Tx, owner, id string) error {
	_, err := tx.Exec(ctx, `INSERT INTO meetings VALUES ($1,$2,
 'SYNTHETIC: Desktop consent demo', 'Fabricated participants approved a fictional demo.',
 '[00:00] Synthetic speaker: No local Meeting data was read or uploaded.',
 '2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',true) ON CONFLICT (id) DO NOTHING`, id, owner)
	if err != nil {
		return err
	}
	var valid bool
	err = tx.QueryRow(ctx, `SELECT title='SYNTHETIC: Desktop consent demo'
 AND summary='Fabricated participants approved a fictional demo.'
 AND transcript='[00:00] Synthetic speaker: No local Meeting data was read or uploaded.'
 AND started_at='2026-09-13T12:00:00Z' AND updated_at=started_at AND synthetic
 FROM meetings WHERE id=$1 AND owner_id=$2`, id, owner).Scan(&valid)
	if err != nil || !valid {
		return errors.New("demo unavailable")
	}
	return nil
}

func OpenDemoPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid demo database configuration")
	}
	config.MaxConns = 2
	config.ConnConfig.RuntimeParams["statement_timeout"] = "3000"
	config.ConnConfig.RuntimeParams["lock_timeout"] = "2000"
	config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "5000"
	config.AfterConnect = verifyDemoRole
	return pgxpool.NewWithConfig(ctx, config)
}

func verifyDemoRole(ctx context.Context, conn *pgx.Conn) error {
	var safe bool
	err := conn.QueryRow(ctx, `SELECT current_user='gappd_demo_writer' AND NOT rolsuper AND NOT rolbypassrls
 AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member=pg_roles.oid)
 AND NOT EXISTS (SELECT FROM pg_class WHERE relname='meetings' AND relowner=pg_roles.oid)
 FROM pg_roles WHERE rolname=current_user`).Scan(&safe)
	if err != nil || !safe {
		return errors.New("runtime requires isolated gappd_demo_writer role")
	}
	return nil
}
