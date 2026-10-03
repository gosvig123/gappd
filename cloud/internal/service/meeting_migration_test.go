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

func TestMeetingCopyIDMatchesSQL(t *testing.T) {
	database(t)
	conn := lifecycleAdmin(t)
	ctx := context.Background()
	for _, localID := range []string{"72619a1d-f713-4f46-a2b8-c74e568726b1", "another-local-meeting"} {
		var sqlID string
		if err := conn.QueryRow(ctx, `SELECT meeting_copy_id($1,$2)::text`, "owner-a", localID).Scan(&sqlID); err != nil {
			t.Fatal(err)
		}
		if sqlID != service.MeetingCopyID("owner-a", localID) {
			t.Fatalf("Go and SQL identity differ: %s %s", sqlID, service.MeetingCopyID("owner-a", localID))
		}
		if sqlID == service.MeetingCopyID("owner-b", localID) {
			t.Fatal("identity ignores the owner")
		}
	}
	if service.MeetingCopyID("owner-a", "x") == service.MeetingCopyID("owner-a", "y") {
		t.Fatal("identity ignores the local Meeting")
	}
}

// Migrating a database that holds demo state keeps the seeded Meeting and removes every demo object.
func TestMigrationsRemoveTheUploadDemo(t *testing.T) {
	database(t)
	conn := migrationDatabase(t)
	applyOldMigrations(t, conn)
	accepted := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	mustExec(t, conn, `INSERT INTO demo_lifecycle(id,owner_id,accepted_at,expires_at,deleted_at)
 VALUES(demo_meeting_id($1),$1,$2,$2::timestamptz+interval '720 hours',$2)`, "deleted-owner", accepted)
	mustExec(t, conn, `INSERT INTO meetings VALUES(demo_meeting_id($1),$1,'SYNTHETIC: Desktop consent demo',
 'Fabricated participants approved a fictional demo.','[00:00] Synthetic speaker: No local Meeting data was read or uploaded.',
 '2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',true)`, "live-owner")
	mustExec(t, conn, `INSERT INTO meetings VALUES(selected_meeting_id($1),$1,'SYNTHETIC: Selected local Meeting',
 'Fabricated participants will review a fictional paper prototype.','[00:00] Synthetic speaker: Review the fictional paper prototype.',
 '2026-09-14T12:00:00Z','2026-09-14T12:00:00Z',true)`, "live-owner")
	if err := admin.Seed(context.Background(), conn, "seed-owner"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := admin.Migrate(context.Background(), conn); err != nil {
			t.Fatal(err)
		}
	}
	assertDemoRemoved(t, conn)
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

func applyOldMigrations(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	for _, file := range []string{"001.sql", "002.sql", "003.sql"} {
		data, err := os.ReadFile("../admin/" + file)
		if err != nil {
			t.Fatal(err)
		}
		mustExec(t, conn, string(data))
	}
}

func assertDemoRemoved(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	ctx := context.Background()
	result, err := conn.Query(ctx, `SELECT id::text||':'||owner_id FROM meetings ORDER BY owner_id`)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := pgx.CollectRows(result, pgx.RowTo[string])
	if err != nil || len(rows) != 1 || rows[0] != service.SyntheticMeetingID+":seed-owner" {
		t.Fatalf("synthetic rows = %v, %v; want only the seeded Meeting", rows, err)
	}
	var leftovers int
	if err := conn.QueryRow(ctx, `SELECT
 (SELECT count(*) FROM pg_class WHERE relname='demo_lifecycle') +
 (SELECT count(*) FROM pg_proc WHERE proname IN ('demo_meeting_id','selected_meeting_id','guard_demo_content','protect_demo_lifecycle')) +
 (SELECT count(*) FROM pg_trigger WHERE tgname IN ('guard_demo_content','guard_selected_content')) +
 (SELECT count(*) FROM pg_policies WHERE tablename='meetings' AND policyname<>'meeting_owner')`).Scan(&leftovers); err != nil || leftovers != 0 {
		t.Fatalf("demo objects left: %d, %v", leftovers, err)
	}
	var tables, versions int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM pg_class
 WHERE relname IN ('cloud_meetings','meeting_lifecycle') AND relkind='r'`).Scan(&tables); err != nil || tables != 2 {
		t.Fatal("real copy tables missing", err)
	}
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM cloud_migrations WHERE version=12`).Scan(&versions); err != nil || versions != 1 {
		t.Fatal("version 12 not recorded", err)
	}
}
