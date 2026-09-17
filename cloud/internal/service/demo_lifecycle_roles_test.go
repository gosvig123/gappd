package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLifecycleReaderIsolationAndImmutableWriterState(t *testing.T) {
	reader, writer := demoDatabase(t)
	owner := "roles-" + time.Now().Format("150405.000000000")
	if _, err := service.CreateDemo(context.Background(), writer, owner); err != nil {
		t.Fatal(err)
	}
	for _, account := range []string{"", owner, "other-owner"} {
		tx, err := reader.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, account); err != nil {
			t.Fatal(err)
		}
		var count int
		err = tx.QueryRow(context.Background(), `SELECT count(*) FROM demo_lifecycle WHERE owner_id=$1`, owner).Scan(&count)
		if err != nil || (count == 1) != (account == owner) {
			t.Fatalf("lifecycle owner leak %d %v", count, err)
		}
		tx.Rollback(context.Background())
	}
	assertLifecycleForbidden(t, reader, owner, []string{`DELETE FROM demo_lifecycle`, `UPDATE demo_lifecycle SET deleted_at=now()`, `INSERT INTO demo_lifecycle(id,owner_id,deleted_at) VALUES (demo_meeting_id('x'),'x',now())`})
	assertLifecycleForbidden(t, writer, owner, []string{`DELETE FROM demo_lifecycle`, `UPDATE demo_lifecycle SET expires_at=now()+interval '100 days'`, `UPDATE demo_lifecycle SET accepted_at=now()`})
	assertUnmarkedDeleteDenied(t, writer, owner)
}

func assertLifecycleForbidden(t *testing.T, pool *pgxpool.Pool, owner string, statements []string) {
	t.Helper()
	for _, sql := range statements {
		tx, err := pool.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, owner)
		if _, err = tx.Exec(context.Background(), sql); err == nil {
			t.Errorf("role allowed %s", sql)
		}
		tx.Rollback(context.Background())
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM demo_lifecycle`).Scan(&count); err != nil || count != 0 {
		t.Fatal("pooled lifecycle context leaked", err)
	}
}

func assertUnmarkedDeleteDenied(t *testing.T, pool *pgxpool.Pool, owner string) {
	t.Helper()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, owner)
	result, err := tx.Exec(context.Background(), `DELETE FROM meetings WHERE owner_id=$1`, owner)
	if err != nil || result.RowsAffected() != 0 {
		t.Fatal("unmarked delete allowed", err)
	}
}

func TestCleanupRoleCannotDeleteActiveOrSeedAndRejectsAdmin(t *testing.T) {
	reader, writer := demoDatabase(t)
	conn := lifecycleAdmin(t)
	cleanup := cleanupConnection(t, conn)
	owner := "cleanup-active-" + time.Now().Format("150405.000000000")
	if _, err := service.CreateDemo(context.Background(), writer, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CleanupDemo(context.Background(), conn); err == nil {
		t.Fatal("cleanup accepted admin")
	}
	assertCleanupActiveDenied(t, cleanup, owner)
	if _, err := service.Read(context.Background(), reader, owner, service.DemoMeetingID(owner)); err != nil {
		t.Fatal("cleanup changed active row", err)
	}
}

func assertCleanupActiveDenied(t *testing.T, conn *pgx.Conn, owner string) {
	t.Helper()
	tx, err := conn.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, owner)
	for _, sql := range []string{`UPDATE demo_lifecycle SET deleted_at=now() WHERE owner_id=$1`, `DELETE FROM meetings WHERE owner_id=$1`} {
		result, err := tx.Exec(context.Background(), sql, owner)
		if err != nil || result.RowsAffected() != 0 {
			t.Fatal("cleanup accessed active content", err)
		}
	}
}
