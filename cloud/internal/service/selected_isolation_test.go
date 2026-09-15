package service_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
)

func assertSelectedRead(t *testing.T, reader *pgxpool.Pool, owner, id string) {
	t.Helper()
	value, err := service.Read(context.Background(), reader, owner, id)
	document, _ := service.ParseSelectedDocument([]byte(service.SelectedFixtureBytes))
	if err != nil || value.Title != document.Title || value.Transcript != document.Transcript || value.Summary != document.Summary {
		t.Fatal("transported fields differ", err)
	}
	if _, err = service.Read(context.Background(), reader, "other-owner", id); err == nil {
		t.Fatal("cross-owner read")
	}
}

func assertSelectedGone(t *testing.T, reader, writer *pgxpool.Pool, owner string) {
	t.Helper()
	id := service.SelectedMeetingID(owner)
	if _, err := service.Read(context.Background(), reader, owner, id); err == nil {
		t.Fatal("deleted or expired read")
	}
	conn := lifecycleAdmin(t)
	var removed bool
	err := conn.QueryRow(context.Background(), `SELECT deleted_at IS NOT NULL AND NOT EXISTS(SELECT FROM meetings WHERE id=$2 AND owner_id=$1) FROM demo_lifecycle WHERE owner_id=$1 AND id=$2`, owner, id).Scan(&removed)
	if err != nil || !removed {
		t.Fatal("atomic removal/marker missing", err)
	}
}

func TestSelectedInputAuthAndRoleBounds(t *testing.T) {
	reader, writer := demoDatabase(t)
	a, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithDemo(a, reader, writer, "desktop"))
	defer host.Close()
	for _, body := range []string{"", `{"synthetic":true,"transcript":"private"}`, service.SelectedFixtureBytes + "\n", strings.Repeat("x", 4097), strings.Replace(service.SelectedFixtureBytes, "paper prototype", "private content", 1)} {
		if code, _ := selectedRequest(t, host.URL, sign("selected-invalid"), "POST", body); code == 200 {
			t.Fatal("invalid body accepted")
		}
	}
	for _, claims := range [][2]string{{"meetings:read", "desktop"}, {"meetings:sync", "other-client"}} {
		auth, token := signerScopes(t, claims[0], claims[1])
		server := httptest.NewServer(service.HandlerWithDemo(auth, reader, writer, "desktop"))
		code, _ := selectedRequest(t, server.URL, token("selected-invalid"), "POST", service.SelectedFixtureBytes)
		server.Close()
		if code == 200 {
			t.Fatal("wrong scope/client accepted")
		}
	}
	assertSelectedWriterBounds(t, writer)
}

func assertSelectedWriterBounds(t *testing.T, writer *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, owner := range []string{"", "another-owner", "selected-rls"} {
		tx, err := writer.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO meetings VALUES($1,'selected-rls','private','','','2026-09-14T12:00:00Z','2026-09-14T12:00:00Z',true)`, service.SelectedMeetingID("selected-rls"))
		if err == nil {
			t.Fatal("role accepted arbitrary content")
		}
		tx.Rollback(ctx)
	}
}

func TestSelectedExpiryUsesExistingBoundedCleanup(t *testing.T) {
	reader, writer := demoDatabase(t)
	conn := lifecycleAdmin(t)
	owner := "selected-expired-" + time.Now().Format("150405.000000000")
	id := service.SelectedMeetingID(owner)
	// Seed already-expired synthetic state before content, without changing an asserted result.
	accepted := time.Now().Add(-31 * 24 * time.Hour)
	mustExec(t, conn, `INSERT INTO demo_lifecycle(id,owner_id,accepted_at,expires_at) VALUES($1,$2,$3,$3::timestamptz+interval '720 hours')`, id, owner, accepted)
	mustExec(t, conn, `ALTER TABLE meetings DISABLE TRIGGER guard_selected_content`)
	mustExec(t, conn, `INSERT INTO meetings VALUES($1,$2,'SYNTHETIC expired','','',now(),now(),true)`, id, owner)
	mustExec(t, conn, `ALTER TABLE meetings ENABLE TRIGGER guard_selected_content`)
	if _, err := service.Read(context.Background(), reader, owner, id); err == nil {
		t.Fatal("expired content readable before cleanup")
	}
	assertExpiredSelectedUploadDenied(t, reader, writer, owner)
	cleanup := cleanupConnection(t, conn)
	if _, err := service.CleanupDemo(context.Background(), cleanup); err != nil {
		t.Fatal(err)
	}
	assertSelectedGone(t, reader, writer, owner)
}

func TestSelectedOwnerCannotDeleteOrInsertOtherOwnersFixture(t *testing.T) {
	reader, writer := demoDatabase(t)
	a, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithDemo(a, reader, writer, "desktop"))
	defer host.Close()
	owner := "selected-owner-" + time.Now().Format("150405.000000000")
	if code, _ := selectedRequest(t, host.URL, sign(owner), "POST", service.SelectedFixtureBytes); code != 200 {
		t.Fatal("create failed")
	}
	if code, _ := selectedRequest(t, host.URL, sign("other-"+owner), "DELETE", ""); code != 200 {
		t.Fatal("other delete failed")
	}
	assertSelectedRead(t, reader, owner, service.SelectedMeetingID(owner))
	assertExactCrossOwnerInsertDenied(t, writer, owner+"-absent")
}

func assertExactCrossOwnerInsertDenied(t *testing.T, writer *pgxpool.Pool, owner string) {
	t.Helper()
	ctx := context.Background()
	tx, err := writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id',$1,true)`, "other-"+owner); err != nil {
		t.Fatal(err)
	}
	document, _ := service.ParseSelectedDocument([]byte(service.SelectedFixtureBytes))
	_, err = tx.Exec(ctx, `INSERT INTO meetings VALUES($1,$2,$3,$4,$5,$6,$6,true)`, service.SelectedMeetingID(owner), owner, document.Title, document.Summary, document.Transcript, document.StartedAt)
	if err == nil {
		t.Fatal("cross-owner exact fixture insert accepted")
	}
}

func assertExpiredSelectedUploadDenied(t *testing.T, reader, writer *pgxpool.Pool, owner string) {
	t.Helper()
	a, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithDemo(a, reader, writer, "desktop"))
	defer host.Close()
	if code, _ := selectedRequest(t, host.URL, sign(owner), "POST", service.SelectedFixtureBytes); code == 200 {
		t.Fatal("expired identity accepted a retry")
	}
}
