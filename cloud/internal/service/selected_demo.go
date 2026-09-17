package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SelectedMeetingID never recycles an old demo identity, including deleted identities.
func SelectedMeetingID(owner string) string {
	sum := sha256.Sum256([]byte("gappd-selected-local-fixture-v1:" + owner))
	sum[6] = (sum[6] & 15) | 128
	sum[8] = (sum[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

func selectedDemoHandler(pool *pgxpool.Pool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, 4097))
		if err != nil || len(data) > 4096 {
			http.Error(w, "invalid fixture", 400)
			return
		}
		owner, _ := r.Context().Value(ownerKey{}).(string)
		status := "accepted"
		if r.Method == http.MethodDelete {
			status = "deleted"
			err = deleteSelected(r.Context(), pool, owner, data)
		} else {
			err = createSelected(r.Context(), pool, owner, data)
		}
		if err != nil {
			http.Error(w, "selected fixture unavailable", 400)
			return
		}
		acknowledgeSelected(w, r, pool, owner, status)
	})
}

func createSelected(ctx context.Context, pool *pgxpool.Pool, owner string, data []byte) error {
	document, err := ParseSelectedDocument(data)
	if err != nil || owner == "" {
		return errors.New("fixture required")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if err = lockDemo(ctx, tx, owner); err != nil {
		return err
	}
	if err = insertSelected(ctx, tx, owner, document); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func insertSelected(ctx context.Context, tx pgx.Tx, owner string, document SelectedDocument) error {
	id := SelectedMeetingID(owner)
	_, err := tx.Exec(ctx, `INSERT INTO meetings VALUES ($1,$2,$3,$4,$5,$6,$6,true) ON CONFLICT (id) DO NOTHING`, id, owner, document.Title, document.Summary, document.Transcript, document.StartedAt)
	if err != nil {
		return err
	}
	var valid bool
	err = tx.QueryRow(ctx, `SELECT title=$3 AND summary=$4 AND transcript=$5 AND started_at=$6 AND updated_at=started_at AND synthetic
 AND EXISTS(SELECT FROM demo_lifecycle l WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id AND l.deleted_at IS NULL AND l.expires_at>clock_timestamp())
 FROM meetings WHERE id=$1 AND owner_id=$2`, id, owner, document.Title, document.Summary, document.Transcript, document.StartedAt).Scan(&valid)
	if err != nil || !valid {
		return errors.New("selected fixture unavailable")
	}
	return nil
}

func deleteSelected(ctx context.Context, pool *pgxpool.Pool, owner string, data []byte) error {
	if len(data) != 0 || owner == "" {
		return errors.New("empty deletion required")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if err = lockDemo(ctx, tx, owner); err != nil {
		return err
	}
	id := SelectedMeetingID(owner)
	_, err = tx.Exec(ctx, `INSERT INTO demo_lifecycle(id,owner_id,deleted_at) VALUES($1,$2,statement_timestamp())
 ON CONFLICT(owner_id,id) DO UPDATE SET deleted_at=coalesce(demo_lifecycle.deleted_at,excluded.deleted_at)`, id, owner)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM meetings WHERE id=$1 AND owner_id=$2`, id, owner); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
