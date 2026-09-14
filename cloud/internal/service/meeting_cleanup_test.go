package service_test

import (
	"context"
	"os"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
)

// meetingCleanupPool provisions both meeting roles and returns the cleanup connection.
func meetingCleanupPool(t *testing.T) *pgx.Conn {
	t.Helper()
	database(t)
	if os.Getenv("TEST_MEETING_CLEANUP_DATABASE_URL") == "" {
		t.Skip("requires TEST_MEETING_CLEANUP_DATABASE_URL")
	}
	conn := lifecycleAdmin(t)
	ctx := context.Background()
	if err := admin.ProvisionMeeting(context.Background(), conn, "synthetic-test-password-only"); err != nil {
		t.Fatal(err)
	}
	if err := admin.ProvisionMeetingCleanup(ctx, conn, "synthetic-test-password-only"); err != nil {
		t.Fatal(err)
	}
	cleanup, err := pgx.Connect(ctx, os.Getenv("TEST_MEETING_CLEANUP_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cleanup.Close(context.Background()) })
	return cleanup
}

// insertExpiredCopies writes expired fixtures directly. Only elapsed time can expire a copy
// through the API, so the tests build the state the same way the synthetic tests do.
func insertExpiredCopies(t *testing.T, conn *pgx.Conn, prefix string, count int) {
	t.Helper()
	mustExec(t, conn, `ALTER TABLE cloud_meetings DISABLE TRIGGER guard_cloud_meeting_insert`)
	defer mustExec(t, conn, `ALTER TABLE cloud_meetings ENABLE TRIGGER guard_cloud_meeting_insert`)
	mustExec(t, conn, `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 SELECT meeting_copy_id($1||n,$1||n),$1||n,$1||n,now()-interval '744 hours',now()-interval '24 hours'
 FROM generate_series(1,$2) n`, prefix, count)
	mustExec(t, conn, `INSERT INTO cloud_meetings(id,owner_id,title,summary,transcript,started_at,updated_at,revision,document)
 SELECT meeting_copy_id(owner_id,local_id),owner_id,'expired','','',now(),now(),1,'{"version":1}'::jsonb
 FROM meeting_lifecycle WHERE owner_id LIKE $1`, prefix+"%")
}

func TestMeetingCleanupRemovesExpiredCopiesAndKeepsMarkers(t *testing.T) {
	cleanup := meetingCleanupPool(t)
	reader, writer := meetingDatabase(t)
	conn := lifecycleAdmin(t)
	prefix := "cleanup-real-" + copyOwner("run")
	insertExpiredCopies(t, conn, prefix, 3)
	// A live copy must survive the sweep.
	live := copyOwner("cleanup-live")
	uploadCopy(t, writer, live, "local-live", 1)

	removed, err := service.CleanupMeeting(context.Background(), cleanup)
	if err != nil {
		t.Fatal(err)
	}
	if removed < 3 {
		t.Fatalf("removed %d, expected at least 3", removed)
	}
	var content, markers int
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM cloud_meetings WHERE owner_id LIKE $1`, prefix+"%").Scan(&content); err != nil || content != 0 {
		t.Fatal("expired content remained", err)
	}
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM meeting_lifecycle WHERE owner_id LIKE $1 AND deleted_at IS NOT NULL`, prefix+"%").Scan(&markers); err != nil || markers != 3 {
		t.Fatal("markers missing", err)
	}
	if visibleCopies(t, reader, live, service.MeetingCopyID(live, "local-live")) != 1 {
		t.Fatal("a live copy was removed")
	}
}

func TestMeetingCleanupIsBoundedAndIgnoresLiveCopies(t *testing.T) {
	cleanup := meetingCleanupPool(t)
	conn := lifecycleAdmin(t)
	prefix := "cleanup-bound-" + copyOwner("run")
	insertExpiredCopies(t, conn, prefix, 101)

	removed, err := service.CleanupMeeting(context.Background(), cleanup)
	if err != nil || removed != 100 {
		t.Fatalf("removed %d (err %v), expected exactly 100", removed, err)
	}
	var remaining int
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM cloud_meetings WHERE owner_id LIKE $1`, prefix+"%").Scan(&remaining); err != nil || remaining != 1 {
		t.Fatal("batch bound not honoured", err)
	}
	var markers int
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM meeting_lifecycle WHERE owner_id LIKE $1 AND deleted_at IS NOT NULL`, prefix+"%").Scan(&markers); err != nil || markers != 100 {
		t.Fatal("markers missing", err)
	}
}

func TestMeetingCleanupRoleCannotRemoveMarkersOrLiveContent(t *testing.T) {
	cleanup := meetingCleanupPool(t)
	conn := lifecycleAdmin(t)
	prefix := "cleanup-role-" + copyOwner("run")
	insertExpiredCopies(t, conn, prefix, 1)
	reader, writer := meetingDatabase(t)
	live := copyOwner("cleanup-role-live")
	liveID := uploadCopy(t, writer, live, "local-live", 1)

	var id string
	if err := conn.QueryRow(context.Background(), `SELECT id::text FROM cloud_meetings WHERE owner_id LIKE $1`, prefix+"%").Scan(&id); err != nil {
		t.Fatal(err)
	}
	// Marking an expired copy is the role's job.
	mustExec(t, cleanup, `UPDATE meeting_lifecycle SET deleted_at=statement_timestamp() WHERE id=$1::uuid`, id)
	assertCleanupRefusals(t, cleanup, id)
	// A live copy is invisible to the cleanup role, so a sweep cannot touch it.
	if countLiveCopies(t, cleanup, live, liveID) != 0 {
		t.Fatal("cleanup role saw a live copy")
	}
	if visibleCopies(t, reader, live, liveID) != 1 {
		t.Fatal("live copy lost")
	}
}

func assertCleanupRefusals(t *testing.T, cleanup *pgx.Conn, id string) {
	t.Helper()
	refused := []struct {
		name string
		sql  string
		args []any
	}{
		{"clear a marker", `UPDATE meeting_lifecycle SET deleted_at=NULL WHERE id=$1::uuid`, []any{id}},
		{"move an expiry", `UPDATE meeting_lifecycle SET expires_at=now()+interval '720 hours' WHERE id=$1::uuid`, []any{id}},
		{"remove the lifecycle row", `DELETE FROM meeting_lifecycle WHERE id=$1::uuid`, []any{id}},
		{"insert content", `INSERT INTO cloud_meetings(id,owner_id,title,summary,transcript,started_at,updated_at,revision,document)
 VALUES (gen_random_uuid(),'cleanup-insert','t','','',now(),now(),1,'{}'::jsonb)`, nil},
		{"insert a lifecycle row", `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 VALUES (gen_random_uuid(),'cleanup-insert','x',now(),now()+interval '720 hours')`, nil},
	}
	for _, check := range refused {
		if _, err := cleanup.Exec(context.Background(), check.sql, check.args...); err == nil {
			t.Fatalf("cleanup role could %s", check.name)
		}
	}
}

func countLiveCopies(t *testing.T, conn *pgx.Conn, owner, id string) int {
	t.Helper()
	var count int
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM cloud_meetings WHERE owner_id=$1 AND id=$2::uuid`, owner, id).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}
