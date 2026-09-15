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

func TestMigration003PreservesOldMarkersAndSeed(t *testing.T) {
	database(t)
	conn := migrationDatabase(t)
	for _, file := range []string{"001.sql", "002.sql"} {
		data, err := os.ReadFile("../admin/" + file)
		if err != nil {
			t.Fatal(err)
		}
		mustExec(t, conn, string(data))
	}
	owner := "previously-deleted-owner"
	accepted := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	mustExec(t, conn, `INSERT INTO demo_lifecycle(id,owner_id,accepted_at,expires_at,deleted_at) VALUES(demo_meeting_id($1),$1,$2,$2::timestamptz+interval '720 hours',$2)`, owner, accepted)
	if err := admin.Seed(context.Background(), conn, "seed-owner"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := admin.Migrate(context.Background(), conn); err != nil {
			t.Fatal(err)
		}
	}
	assertOldMigrationState(t, conn, owner, accepted)
}

func assertOldMigrationState(t *testing.T, conn *pgx.Conn, owner string, accepted time.Time) {
	t.Helper()
	var unchanged bool
	err := conn.QueryRow(context.Background(), `SELECT accepted_at=$2 AND expires_at=$2::timestamptz+interval '720 hours' AND deleted_at=$2 FROM demo_lifecycle WHERE id=demo_meeting_id($1) AND owner_id=$1`, owner, accepted).Scan(&unchanged)
	if err != nil || !unchanged {
		t.Fatal("migration changed old control records", err)
	}
	var count int
	if err = conn.QueryRow(context.Background(), `SELECT count(*) FROM meetings WHERE id=$1 AND owner_id='seed-owner'`, service.DemoID).Scan(&count); err != nil || count != 1 {
		t.Fatal("seed changed", err)
	}
	_, err = conn.Exec(context.Background(), `INSERT INTO meetings VALUES(demo_meeting_id($1),$1,'SYNTHETIC: Desktop consent demo','Fabricated participants approved a fictional demo.','[00:00] Synthetic speaker: No local Meeting data was read or uploaded.','2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',true)`, owner)
	if err == nil {
		t.Fatal("old deleted identity restored")
	}
	if service.SelectedMeetingID(owner) == service.DemoMeetingID(owner) {
		t.Fatal("namespace reused")
	}
}
