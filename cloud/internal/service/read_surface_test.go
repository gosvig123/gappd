package service_test

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// realReads turns on the union read surface for one test and restores the default after it.
func realReads(t *testing.T, reader *pgxpool.Pool) {
	t.Helper()
	if err := service.SetRealCopies(context.Background(), reader, true); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.SetRealCopies(context.Background(), reader, false) })
}

func TestRealCopyReadSurface(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner, other := copyOwner("read"), copyOwner("read-other")
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 3, "Real weekly sync")); code != 200 {
		t.Fatal("upload")
	}
	ctx := context.Background()
	// Off by default: the copy is stored, but not on the read surface.
	if _, err := service.Read(ctx, reader, owner, id); err == nil {
		t.Fatal("real copy readable before the surface was enabled")
	}
	realReads(t, reader)
	copy, err := service.Read(ctx, reader, owner, id)
	if err != nil || copy.Synthetic || copy.Title != "Real weekly sync" {
		t.Fatalf("owned read: %+v %v", copy, err)
	}
	if !strings.Contains(copy.Transcript, "[0:00] Kristian: Hello.") {
		t.Fatalf("transcript: %q", copy.Transcript)
	}
	if _, err = service.Read(ctx, reader, other, id); err == nil {
		t.Fatal("cross-owner read through the view")
	}
	assertReadPage(t, reader, owner, other, id)
	assertReadSearches(t, reader, owner, other, id)
}

func assertReadPage(t *testing.T, reader *pgxpool.Pool, owner, other, id string) {
	t.Helper()
	ctx := context.Background()
	page, err := service.List(ctx, reader, owner, service.ListParams{Limit: 20})
	if err != nil || len(page.Meetings) != 1 || page.Meetings[0].ID != id {
		t.Fatalf("list: %v %v", page, err)
	}
	if none, err := service.List(ctx, reader, other, service.ListParams{Limit: 20}); err != nil || len(none.Meetings) != 0 {
		t.Fatalf("cross-owner list: %v %v", none, err)
	}
}

func assertReadSearches(t *testing.T, reader *pgxpool.Pool, owner, other, id string) {
	t.Helper()
	ctx := context.Background()
	found, err := service.Search(ctx, reader, owner, "Hello", 10)
	if err != nil || len(found.Matches) != 1 || found.Matches[0].ID != id {
		t.Fatalf("search: %v %v", found, err)
	}
	if none, err := service.Search(ctx, reader, other, "Hello", 10); err != nil || len(none.Matches) != 0 {
		t.Fatalf("cross-owner search: %v %v", none, err)
	}
}

func TestRealCopyDisappearsFromTheReadSurfaceAfterDeletion(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner := copyOwner("read-delete")
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "Real weekly sync")); code != 200 {
		t.Fatal("upload")
	}
	realReads(t, reader)
	ctx := context.Background()
	if _, err := service.Read(ctx, reader, owner, id); err != nil {
		t.Fatal("copy missing before deletion", err)
	}
	if code, _ := meetingRequest(t, host.URL, sign(owner), "DELETE", deleteBody(localMeeting)); code != 200 {
		t.Fatal("delete")
	}
	if _, err := service.Read(ctx, reader, owner, id); err == nil {
		t.Fatal("deleted copy still readable")
	}
	if page, err := service.List(ctx, reader, owner, service.ListParams{Limit: 20}); err != nil || len(page.Meetings) != 0 {
		t.Fatalf("deleted copy listed: %v %v", page, err)
	}
	if found, err := service.Search(ctx, reader, owner, "Hello", 10); err != nil || len(found.Matches) != 0 {
		t.Fatalf("deleted copy found: %v %v", found, err)
	}
}

// The union view carries the synthetic demo rows beside the real copies.
func TestRealCopySurfaceKeepsTheSyntheticSlice(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner := "user_synthetic"
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "Real weekly sync")); code != 200 {
		t.Fatal("upload")
	}
	realReads(t, reader)
	page, err := service.List(context.Background(), reader, owner, service.ListParams{Limit: 20})
	if err != nil || len(page.Meetings) != 2 {
		t.Fatalf("list: %v %v", page, err)
	}
	seeded, err := service.Read(context.Background(), reader, owner, service.DemoID)
	if err != nil || !seeded.Synthetic {
		t.Fatal("seeded fixture lost", err)
	}
	if copy, err := service.Read(context.Background(), reader, owner, id); err != nil || copy.Synthetic {
		t.Fatalf("real copy: %+v %v", copy, err)
	}
}

// Enabling the surface must fail closed until migration 005 is applied.
func TestRealCopiesRequireTheUnionView(t *testing.T) {
	conn, pool := openFreshDatabase(t)
	applyMigrations(t, conn, "001.sql", "002.sql", "003.sql", "004.sql")
	if err := service.SetRealCopies(context.Background(), pool, true); err == nil {
		t.Fatal("real copies enabled without the union view")
	}
	applyMigrations(t, conn, "005.sql")
	t.Cleanup(func() { _ = service.SetRealCopies(context.Background(), pool, false) })
	if err := service.SetRealCopies(context.Background(), pool, true); err != nil {
		t.Fatal("real copies refused after migration 005", err)
	}
}

func applyMigrations(t *testing.T, conn *pgx.Conn, files ...string) {
	t.Helper()
	for _, file := range files {
		data, err := os.ReadFile("../admin/" + file)
		if err != nil {
			t.Fatal(err)
		}
		mustExec(t, conn, string(data))
	}
}

// openFreshDatabase creates an empty database and returns an admin connection plus a
// reader pool on it, so a migration can be applied without the others.
func openFreshDatabase(t *testing.T) (*pgx.Conn, *pgxpool.Pool) {
	t.Helper()
	root := lifecycleAdmin(t)
	name := "read_surface_" + time.Now().Format("150405000000000")
	quoted := pgx.Identifier{name}.Sanitize()
	mustExec(t, root, `CREATE DATABASE `+quoted)
	t.Cleanup(func() { mustExec(t, root, `DROP DATABASE `+quoted) })
	adminConfig, err := pgx.ParseConfig(os.Getenv("TEST_ADMIN_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	adminConfig.Database = name
	conn, err := pgx.ConnectConfig(context.Background(), adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn, freshReaderPool(t, name)
}

func freshReaderPool(t *testing.T, name string) *pgxpool.Pool {
	t.Helper()
	readerURL, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	readerURL.Path = "/" + name
	pool, err := service.OpenPool(context.Background(), readerURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
