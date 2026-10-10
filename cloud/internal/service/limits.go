package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// Request classes and their per-account budgets.
const (
	ClassRead  = "read"
	ClassWrite = "write"
)

// Per-account limits. They are in-process and per-instance: a restart clears them and a second
// instance would count separately.
// ponytail: in-process buckets, add a shared store if the service ever runs more than one instance.
const (
	readBurstPerMinute  = 60
	writeBurstPerMinute = 12
	maxCopiesPerAccount = 500
	maxBytesPerAccount  = 64 << 20
)

var errStorageFull = errors.New("account storage limit reached")

type bucket struct {
	tokens float64
	at     time.Time
}

// Limiter is a per-subject token bucket, so one account cannot exhaust the service or its cost.
type Limiter struct {
	ReadBurst  int
	WriteBurst int
	mu         sync.Mutex
	now        func() time.Time
	buckets    map[string]*bucket
}

func NewLimiter() *Limiter {
	return &Limiter{ReadBurst: readBurstPerMinute, WriteBurst: writeBurstPerMinute,
		now: time.Now, buckets: map[string]*bucket{}}
}

// allow reports whether one more request fits the budget for this class.
func (l *Limiter) allow(class, subject string) bool {
	burst := l.ReadBurst
	if class == ClassWrite {
		burst = l.WriteBurst
	}
	if burst <= 0 || subject == "" {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now, key := l.now(), class+":"+subject
	entry, ok := l.buckets[key]
	if !ok {
		entry = &bucket{tokens: float64(burst), at: now}
		l.buckets[key] = entry
	}
	entry.tokens = min(float64(burst), entry.tokens+now.Sub(entry.at).Seconds()*float64(burst)/60)
	entry.at = now
	if entry.tokens < 1 {
		return false
	}
	entry.tokens--
	return true
}

// checkCapacity refuses a write that would pass the account's stored-copy budget. The copy being
// written is excluded, so a revision update cannot fail just because the account is at the cap.
func checkCapacity(ctx context.Context, tx pgx.Tx, owner, id string, incoming int) error {
	var copies int
	var bytes int64
	err := tx.QueryRow(ctx, `SELECT count(*),
 coalesce(sum(octet_length(title)+octet_length(summary)+octet_length(transcript)),0)
 FROM cloud_meetings WHERE owner_id=$1 AND id<>$2::uuid`, owner, id).Scan(&copies, &bytes)
	if err != nil {
		return errors.New("cloud copy unavailable")
	}
	if copies >= maxCopiesPerAccount || bytes+int64(incoming) > maxBytesPerAccount {
		return errStorageFull
	}
	return nil
}
