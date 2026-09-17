package service

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func acknowledgeSelected(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, owner, status string) {
	result := map[string]string{"status": status, "subject": owner}
	if status == "accepted" {
		expiry, err := selectedExpiry(r, pool, owner)
		if err != nil {
			http.Error(w, "acknowledgment unavailable", 503)
			return
		}
		result["id"], result["expires_at"] = SelectedMeetingID(owner), expiry
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func selectedExpiry(r *http.Request, pool *pgxpool.Pool, owner string) (string, error) {
	ctx := r.Context()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		return "", err
	}
	var expiry time.Time
	err = tx.QueryRow(ctx, `SELECT expires_at FROM demo_lifecycle WHERE owner_id=$1 AND id=$2`, owner, SelectedMeetingID(owner)).Scan(&expiry)
	return expiry.UTC().Format(time.RFC3339Nano), err
}
