package service_test

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Provisioning runs role and policy DDL, which takes an exclusive lock on every meeting table.
// Re-running it for each test, while another connection still holds a row lock, deadlocks. Each
// role is therefore provisioned once per test binary.
var (
	readerOnce   sync.Once
	demoOnce     sync.Once
	meetingOnce  sync.Once
	cleanupOnce  sync.Once
	provisionErr error
)

// fixtureTx runs one fixture in a single transaction and retries a deadlock. Fixture SQL takes
// an exclusive lock on a meeting table, so a concurrent transaction can turn it into a deadlock.
// That is a test-fixture problem, not a product one, and a retry keeps the fixture atomic.
func fixtureTx(t *testing.T, conn *pgx.Conn, run func(ctx context.Context, tx pgx.Tx) error) {
	t.Helper()
	ctx := context.Background()
	for attempt := 0; attempt < 4; attempt++ {
		tx, err := conn.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		err = run(ctx, tx)
		if err == nil {
			if err = tx.Commit(ctx); err == nil {
				return
			}
		}
		_ = tx.Rollback(ctx)
		if !retryableFixtureError(err) {
			t.Fatal(err)
		}
		time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
	}
	t.Fatal("fixture could not commit after retries")
}

func retryableFixtureError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "deadlock") || strings.Contains(message, "could not serialize") ||
		strings.Contains(message, "lock timeout")
}

func provisionRole(t *testing.T, once *sync.Once, run func(context.Context, *pgx.Conn) error) {
	t.Helper()
	once.Do(func() {
		url := os.Getenv("TEST_ADMIN_DATABASE_URL")
		if url == "" {
			return
		}
		ctx := context.Background()
		conn, err := pgx.Connect(ctx, url)
		if err != nil {
			provisionErr = err
			return
		}
		defer conn.Close(ctx)
		provisionErr = run(ctx, conn)
	})
	if provisionErr != nil {
		t.Fatal(provisionErr)
	}
}
