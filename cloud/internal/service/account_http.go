package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxAccountBody bounds the empty body these two account actions accept.
const MaxAccountBody = 64

// deleteAllHandler removes every cloud copy of the calling account and blocks uploads under a
// new generation.
func deleteAllHandler(pool *pgxpool.Pool) http.Handler {
	return accountAction(pool, func(ctx context.Context, owner string) (map[string]any, error) {
		removed, err := DeleteAccountCopies(ctx, pool, owner)
		return map[string]any{"status": "deleted", "subject": owner, "removed": removed}, err
	})
}

// consentHandler opens uploads again and returns the new generation the caller must present.
func consentHandler(pool *pgxpool.Pool) http.Handler {
	return accountAction(pool, func(ctx context.Context, owner string) (map[string]any, error) {
		generation, err := ConsentUploads(ctx, pool, owner)
		return map[string]any{"status": "allowed", "subject": owner, "generation": generation}, err
	})
}

// accountAction is the shared shape of the two account routes: an authenticated, empty-bodied
// action that answers with a small JSON object or one of two failure statuses.
func accountAction(pool *pgxpool.Pool, run func(ctx context.Context, owner string) (map[string]any, error)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxAccountBody+1))
		if err != nil || len(body) > MaxAccountBody || len(body) != 0 {
			http.Error(w, "empty body required", http.StatusBadRequest)
			return
		}
		owner, _ := r.Context().Value(ownerKey{}).(string)
		result, err := run(r.Context(), owner)
		if err != nil {
			http.Error(w, "account action unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})
}
