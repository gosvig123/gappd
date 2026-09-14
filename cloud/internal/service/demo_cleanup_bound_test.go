package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
)

func TestCleanupBatchLimitAndRemainingBacklog(t *testing.T) {
	demoDatabase(t)
	conn := lifecycleAdmin(t)
	cleanup := cleanupConnection(t, conn)
	prefix := "cleanup-batch-" + time.Now().Format("150405.000000000")
	insertExpiredBatch(t, conn, prefix)
	count, err := service.CleanupDemo(context.Background(), cleanup)
	if err != nil || count != 100 {
		t.Fatalf("first batch: %d %v", count, err)
	}
	count, err = service.CleanupDemo(context.Background(), cleanup)
	if err != nil || count != 1 {
		t.Fatalf("remaining batch: %d %v", count, err)
	}
	count, err = service.CleanupDemo(context.Background(), cleanup)
	if err != nil || count != 0 {
		t.Fatalf("empty batch: %d %v", count, err)
	}
	var markers int
	if err = conn.QueryRow(context.Background(), `SELECT count(*) FROM demo_lifecycle WHERE owner_id LIKE $1 AND deleted_at IS NOT NULL`, prefix+"%").Scan(&markers); err != nil || markers != 101 {
		t.Fatal("markers missing", err)
	}
}

func insertExpiredBatch(t *testing.T, conn *pgx.Conn, prefix string) {
	t.Helper()
	// Synthetic pre-migration fixtures. No real database is used by these tests.
	fixtureTx(t, conn, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `ALTER TABLE meetings DISABLE TRIGGER guard_demo_content`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO meetings SELECT demo_meeting_id($1||n),$1||n,'SYNTHETIC cleanup','','',now(),now(),true FROM generate_series(1,101) n`, prefix); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO demo_lifecycle(id,owner_id,accepted_at,expires_at)
 SELECT id,owner_id,now()-interval '744 hours',now()-interval '24 hours' FROM meetings WHERE owner_id LIKE $1`, prefix+"%"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `ALTER TABLE meetings ENABLE TRIGGER guard_demo_content`)
		return err
	})
}
