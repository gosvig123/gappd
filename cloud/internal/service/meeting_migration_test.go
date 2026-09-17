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
	for _, synthetic := range []string{service.DemoMeetingID("owner-a"), service.SelectedMeetingID("owner-a")} {
		if synthetic == service.MeetingCopyID("owner-a", "x") {
			t.Fatal("namespace collision with the synthetic slice")
		}
	}
}

// Migration 004 must be additive: it never changes the synthetic table or its control records.
func TestMigration004IsAdditive(t *testing.T) {
	database(t)
	conn := migrationDatabase(t)
	applyOldMigrations(t, conn)
	owner := "additive-owner"
	accepted := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	mustExec(t, conn, `INSERT INTO demo_lifecycle(id,owner_id,accepted_at,expires_at,deleted_at)
 VALUES(demo_meeting_id($1),$1,$2,$2::timestamptz+interval '720 hours',$2)`, owner, accepted)
	if err := admin.Seed(context.Background(), conn, "seed-owner"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := admin.Migrate(context.Background(), conn); err != nil {
			t.Fatal(err)
		}
	}
	assertOldMigrationState(t, conn, owner, accepted)
	assertVersionFourAdded(t, conn)
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

func assertVersionFourAdded(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	ctx := context.Background()
	var recorded int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM cloud_migrations WHERE version=4`).Scan(&recorded); err != nil || recorded != 1 {
		t.Fatal("version 4 not recorded", err)
	}
	var added int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM pg_class
 WHERE relname IN ('cloud_meetings','meeting_lifecycle') AND relkind='r'`).Scan(&added); err != nil || added != 2 {
		t.Fatal("new tables missing", err)
	}
	var columns int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
 WHERE table_name='meetings' AND column_name IN ('document','revision')`).Scan(&columns); err != nil || columns != 0 {
		t.Fatal("migration changed the synthetic table", err)
	}
	for _, role := range []string{"gappd_demo_writer", "gappd_demo_cleanup"} {
		var granted bool
		err := conn.QueryRow(ctx, `SELECT has_table_privilege($1,'cloud_meetings','SELECT')
 OR has_table_privilege($1,'meeting_lifecycle','SELECT')`, role).Scan(&granted)
		if err != nil || granted {
			t.Fatalf("synthetic role reached the real tables: %s %v", role, err)
		}
	}
}
