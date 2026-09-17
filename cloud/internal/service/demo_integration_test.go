package service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func demoDatabase(t *testing.T) (*pgxpool.Pool, *pgxpool.Pool) {
	t.Helper()
	reader := database(t)
	if os.Getenv("TEST_DEMO_DATABASE_URL") == "" {
		t.Skip("requires TEST_DEMO_DATABASE_URL")
	}
	provisionRole(t, &demoOnce, func(ctx context.Context, conn *pgx.Conn) error {
		return admin.ProvisionDemo(ctx, conn, "synthetic-test-password-only")
	})
	writer, err := service.OpenDemoPool(context.Background(), os.Getenv("TEST_DEMO_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	return reader, writer
}

func TestDemoTransportAndIdempotency(t *testing.T) {
	reader, writer := demoDatabase(t)
	a, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithDemo(a, reader, writer, "desktop"))
	defer host.Close()
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() { postDemo(t, host.URL, sign("user_demo_a"), service.DemoMeetingID("user_demo_a")) })
	}
	workers.Wait()
	postDemo(t, host.URL, sign("user_demo_b"), service.DemoMeetingID("user_demo_b"))
	if service.DemoMeetingID("user_demo_a") == service.DemoID {
		t.Fatal("seed reused")
	}
	if _, err := service.Read(context.Background(), reader, "user_demo_b", service.DemoMeetingID("user_demo_a")); err == nil {
		t.Fatal("cross-owner read")
	}
	m, err := service.Read(context.Background(), reader, "user_demo_a", service.DemoMeetingID("user_demo_a"))
	if err != nil || m.Title != "SYNTHETIC: Desktop consent demo" {
		t.Fatalf("fixture read: %v", err)
	}
}

func postDemo(t *testing.T, host, token, id string) {
	t.Helper()
	request, _ := http.NewRequest("POST", host+"/demo-meeting", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Error(err)
		return
	}
	defer response.Body.Close()
	var result map[string]string
	if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Error(err)
		return
	}
	if response.StatusCode != 200 || result["id"] != id || result["status"] != "accepted" {
		t.Errorf("unexpected acknowledgment: %d %v", response.StatusCode, result)
	}
}

func TestDemoWriterRLSAndPrivileges(t *testing.T) {
	_, writer := demoDatabase(t)
	ctx := context.Background()
	tx, err := writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM meetings`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("owner leaked: %d %v", count, err)
	}
	if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id','user_demo_a',true)`); err != nil {
		t.Fatal(err)
	}
	assertDemoForbidden(t, tx)
}

func assertDemoForbidden(t *testing.T, tx pgx.Tx) {
	ctx := context.Background()
	for _, sql := range demoForbiddenSQL() {
		nested, err := tx.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = nested.Exec(ctx, sql); err == nil {
			t.Errorf("writer accepted %s", sql)
		}
		nested.Rollback(ctx)
	}
}

func demoForbiddenSQL() []string {
	return []string{
		`UPDATE meetings SET title='private'`,
		`INSERT INTO meetings VALUES ('00000000-0000-0000-0000-000000000001','user_demo_a','private','','',now(),now(),true)`,
		`INSERT INTO meetings VALUES ('00000000-0000-0000-0000-000000000002','other','SYNTHETIC: Desktop consent demo','Fabricated participants approved a fictional demo.',
 '[00:00] Synthetic speaker: No local Meeting data was read or uploaded.','2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',true)`,
	}
}

func TestDemoCollisionNeverReassigns(t *testing.T) {
	_, writer := demoDatabase(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, os.Getenv("TEST_ADMIN_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	id := service.DemoMeetingID("user_collision")
	_, err = conn.Exec(ctx, `INSERT INTO meetings VALUES ($1,'another_owner','SYNTHETIC collision','','',now(),now(),true) ON CONFLICT DO NOTHING`, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.CreateDemo(ctx, writer, "user_collision"); err == nil {
		t.Fatal("collision accepted")
	}
	var owner string
	if err = conn.QueryRow(ctx, `SELECT owner_id FROM meetings WHERE id=$1`, id).Scan(&owner); err != nil || owner != "another_owner" {
		t.Fatalf("collision changed: %s %v", owner, err)
	}
}

func TestDemoRuntimeRejectsOtherRoles(t *testing.T) {
	demoDatabase(t)
	for _, key := range []string{"TEST_ADMIN_DATABASE_URL", "TEST_DATABASE_URL"} {
		pool, err := service.OpenDemoPool(context.Background(), os.Getenv(key))
		if err != nil {
			t.Fatal(err)
		}
		if err = pool.Ping(context.Background()); err == nil {
			t.Errorf("writer accepted %s", key)
		}
		pool.Close()
	}
}
