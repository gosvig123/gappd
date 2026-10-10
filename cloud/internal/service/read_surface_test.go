package service_test

import (
	"context"
	"strings"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRealCopyReadSurface(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner, other := copyOwner("read"), copyOwner("read-other")
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 3, "Real weekly sync")); code != 200 {
		t.Fatal("upload")
	}
	ctx := context.Background()
	copy, err := service.Read(ctx, reader, owner, id)
	if err != nil || copy.Title != "Real weekly sync" {
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
