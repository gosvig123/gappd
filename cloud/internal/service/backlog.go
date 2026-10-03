package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CleanupTargetSeconds is the physical removal deadline the retention policy promises.
const CleanupTargetSeconds = 24 * 60 * 60

// Backlog is the state of expired copies that the hourly sweep has not removed yet. It is
// content free: two numbers, no accounts and no text.
type Backlog struct {
	ExpiredCopies        int64   `json:"expired_copies"`
	OldestExpiredSeconds float64 `json:"oldest_expired_seconds"`
	TargetSeconds        float64 `json:"target_seconds"`
	Behind               bool    `json:"behind"`
}

// ReadBacklog reports how far behind the sweep is. It answers through an aggregate function, so
// the reader gains no way to see an expired row or another account.
func ReadBacklog(ctx context.Context, pool *pgxpool.Pool) (Backlog, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	backlog := Backlog{TargetSeconds: CleanupTargetSeconds}
	err := pool.QueryRow(ctx, `SELECT expired_copies,oldest_expired_seconds FROM cleanup_backlog()`).
		Scan(&backlog.ExpiredCopies, &backlog.OldestExpiredSeconds)
	if err != nil {
		return Backlog{}, errors.New("backlog unavailable")
	}
	backlog.Behind = backlog.OldestExpiredSeconds > CleanupTargetSeconds
	return backlog, nil
}
