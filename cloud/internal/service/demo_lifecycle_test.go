package service_test

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func lifecycleAdmin(t *testing.T) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), os.Getenv("TEST_ADMIN_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn
}

func mustExec(t *testing.T, conn *pgx.Conn, sql string, args ...any) {
	t.Helper()
	if _, err := conn.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func TestDemoDeletionWinsConcurrentCreatesAndRetries(t *testing.T) {
	reader, writer := demoDatabase(t)
	owner := "lifecycle-concurrent-" + time.Now().Format("150405.000000000")
	var workers sync.WaitGroup
	for range 12 {
		workers.Go(func() { _, _ = service.CreateDemo(context.Background(), writer, owner) })
		workers.Go(func() {
			if err := service.DeleteDemo(context.Background(), writer, owner); err != nil {
				t.Error(err)
			}
		})
	}
	workers.Wait()
	assertDeleted(t, reader, writer, owner)
}

func assertDeleted(t *testing.T, reader, writer *pgxpool.Pool, owner string) {
	t.Helper()
	ctx := context.Background()
	if _, err := service.Read(ctx, reader, owner, service.DemoMeetingID(owner)); err == nil {
		t.Fatal("deleted content returned")
	}
	conn := lifecycleAdmin(t)
	var removed bool
	err := conn.QueryRow(ctx, `SELECT deleted_at IS NOT NULL AND NOT EXISTS(SELECT FROM meetings WHERE id=$2 AND owner_id=$1)
 FROM demo_lifecycle WHERE owner_id=$1 AND id=$2`, owner, service.DemoMeetingID(owner)).Scan(&removed)
	if err != nil || !removed {
		t.Fatalf("non-atomic deletion: %v", err)
	}
	if _, err := service.CreateDemo(ctx, writer, owner); err == nil {
		t.Fatal("delayed create resurrected identity")
	}
}

func TestDemoDeleteBeforeCreateAndRestoreReplay(t *testing.T) {
	reader, writer := demoDatabase(t)
	owner := "lifecycle-absent-" + time.Now().Format("150405.000000000")
	if err := service.DeleteDemo(context.Background(), writer, owner); err != nil {
		t.Fatal(err)
	}
	assertDeleted(t, reader, writer, owner)
	conn := lifecycleAdmin(t)
	_, err := conn.Exec(context.Background(), `INSERT INTO meetings VALUES ($1,$2,'SYNTHETIC: Desktop consent demo',
 'Fabricated participants approved a fictional demo.',
 '[00:00] Synthetic speaker: No local Meeting data was read or uploaded.',
 '2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',true)`, service.DemoMeetingID(owner), owner)
	if err == nil {
		t.Fatal("old content replay bypassed current deletion marker")
	}
	// This is replay against current control records, not a backup/control-plane recovery proof.
}

func TestDemoExpiryAndBoundedCleanup(t *testing.T) {
	reader, writer := demoDatabase(t)
	conn := lifecycleAdmin(t)
	owner := "lifecycle-expired-" + time.Now().Format("150405.000000000")
	insertLegacy(t, conn, owner)
	accepted := time.Now().UTC().Add(-31 * 24 * time.Hour).Format(time.RFC3339)
	if err := admin.BackfillDemo(context.Background(), conn, owner, accepted); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Read(context.Background(), reader, owner, service.DemoMeetingID(owner)); err == nil {
		t.Fatal("expired read")
	}
	if _, err := service.CreateDemo(context.Background(), writer, owner); err == nil {
		t.Fatal("expired retry")
	}
	cleanup := cleanupConnection(t, conn)
	count, err := service.CleanupDemo(context.Background(), cleanup)
	if err != nil || count < 1 || count > 100 {
		t.Fatalf("cleanup: %d %v", count, err)
	}
	assertDeleted(t, reader, writer, owner)
	if _, err = service.Read(context.Background(), reader, "user_synthetic", service.DemoID); err != nil {
		t.Fatal("seed changed", err)
	}
}

func cleanupConnection(t *testing.T, adminConn *pgx.Conn) *pgx.Conn {
	t.Helper()
	if os.Getenv("TEST_CLEANUP_DATABASE_URL") == "" {
		t.Fatal("TEST_CLEANUP_DATABASE_URL required")
	}
	if err := admin.ProvisionCleanup(context.Background(), adminConn, "synthetic-test-password-only"); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(context.Background(), os.Getenv("TEST_CLEANUP_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn
}

func insertLegacy(t *testing.T, conn *pgx.Conn, owner string) {
	t.Helper()
	// Model pre-002 content only, in the disposable synthetic test database.
	mustExec(t, conn, `ALTER TABLE meetings DISABLE TRIGGER guard_demo_content`)
	defer mustExec(t, conn, `ALTER TABLE meetings ENABLE TRIGGER guard_demo_content`)
	mustExec(t, conn, `INSERT INTO meetings VALUES ($1,$2,'SYNTHETIC: Desktop consent demo',
 'Fabricated participants approved a fictional demo.',
 '[00:00] Synthetic speaker: No local Meeting data was read or uploaded.',
 '2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',true)`, service.DemoMeetingID(owner), owner)
}

func TestDemoLegacyBackfillFailsClosedAndNeverExtends(t *testing.T) {
	reader, writer := demoDatabase(t)
	conn := lifecycleAdmin(t)
	owner := "lifecycle-legacy-" + time.Now().Format("150405.000000000")
	insertLegacy(t, conn, owner)
	ctx := context.Background()
	if _, err := service.Read(ctx, reader, owner, service.DemoMeetingID(owner)); err == nil {
		t.Fatal("missing lifecycle readable")
	}
	if _, err := service.CreateDemo(ctx, writer, owner); err == nil {
		t.Fatal("legacy acceptance reset")
	}
	for _, bad := range []string{"", "invalid", time.Now().Add(time.Hour).Format(time.RFC3339)} {
		if err := admin.BackfillDemo(ctx, conn, owner, bad); err == nil {
			t.Fatal("invalid backfill accepted")
		}
	}
	assertBackfillStable(t, conn, writer, owner)
}

func assertBackfillStable(t *testing.T, conn *pgx.Conn, writer *pgxpool.Pool, owner string) {
	t.Helper()
	ctx := context.Background()
	accepted := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	if err := admin.BackfillDemo(ctx, conn, owner, accepted.Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	if err := admin.BackfillDemo(ctx, conn, owner, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateDemo(ctx, writer, owner); err != nil {
		t.Fatal(err)
	}
	var expiry time.Time
	if err := conn.QueryRow(ctx, `SELECT expires_at FROM demo_lifecycle WHERE owner_id=$1`, owner).Scan(&expiry); err != nil {
		t.Fatal(err)
	}
	if !expiry.Equal(accepted.Add(30 * 24 * time.Hour)) {
		t.Fatal("expiry extended")
	}
}
