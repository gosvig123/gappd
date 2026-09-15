package service_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
)

func TestMigration002PreservesLegacyContentAndExistingExpiry(t *testing.T) {
	database(t)
	conn := migrationDatabase(t)
	sql, err := os.ReadFile("../admin/001.sql")
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, conn, string(sql))
	mustExec(t, conn, `INSERT INTO meetings VALUES ($1,'legacy-migration','SYNTHETIC legacy','','','2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',true)`, service.DemoMeetingID("legacy-migration"))
	if err = admin.Migrate(context.Background(), conn); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = conn.QueryRow(context.Background(), `SELECT count(*) FROM demo_lifecycle`).Scan(&count); err != nil || count != 0 {
		t.Fatal("migration invented acceptance", err)
	}
	assertMigratedBackfill(t, conn)
}

func migrationDatabase(t *testing.T) *pgx.Conn {
	t.Helper()
	root := lifecycleAdmin(t)
	name := "synthetic_migration_" + time.Now().Format("150405000000000")
	quoted := pgx.Identifier{name}.Sanitize()
	mustExec(t, root, `CREATE DATABASE `+quoted)
	config, err := pgx.ParseConfig(os.Getenv("TEST_ADMIN_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	config.Database = name
	conn, err := pgx.ConnectConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(context.Background()); mustExec(t, root, `DROP DATABASE `+quoted) })
	return conn
}

func assertMigratedBackfill(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	ctx := context.Background()
	accepted := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	if err := admin.BackfillDemo(ctx, conn, "legacy-migration", accepted.Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	if err := admin.Migrate(ctx, conn); err != nil {
		t.Fatal(err)
	}
	var expiry time.Time
	if err := conn.QueryRow(ctx, `SELECT expires_at FROM demo_lifecycle WHERE owner_id='legacy-migration'`).Scan(&expiry); err != nil {
		t.Fatal(err)
	}
	if !expiry.Equal(accepted.Add(720 * time.Hour)) {
		t.Fatal("migration reset expiry")
	}
	var title string
	if err := conn.QueryRow(ctx, `SELECT title FROM meetings WHERE owner_id='legacy-migration'`).Scan(&title); err != nil || title != "SYNTHETIC legacy" {
		t.Fatal("legacy content changed", err)
	}
}
