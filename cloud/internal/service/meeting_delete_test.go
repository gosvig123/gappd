package service_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func deleteBody(localID string) string {
	value, _ := json.Marshal(map[string]string{"meeting_id": localID})
	return string(value)
}

func TestMeetingDeleteKeepsAPermanentMarker(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner := copyOwner("delete")
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "Weekly sync")); code != 200 {
		t.Fatal("upload")
	}
	code, ack := meetingRequest(t, host.URL, sign(owner), "DELETE", deleteBody(localMeeting))
	if code != 200 || ack["status"] != "deleted" || ack["subject"] != owner {
		t.Fatalf("delete: %d %v", code, ack)
	}
	if count, _, _ := copyRow(t, reader, owner, id); count != 0 {
		t.Fatal("deleted copy still readable")
	}
	if !marked(t, reader, owner, id) {
		t.Fatal("deletion marker missing")
	}
	// A repeated deletion is idempotent and stays indistinguishable.
	if code, ack := meetingRequest(t, host.URL, sign(owner), "DELETE", deleteBody(localMeeting)); code != 200 || ack["status"] != "deleted" {
		t.Fatalf("repeat delete: %d %v", code, ack)
	}
	// The marker outlives the copy, so the same identity never returns.
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 9, "Weekly sync")); code == 200 {
		t.Fatal("deleted copy was re-created")
	}
	if count, _, _ := copyRow(t, reader, owner, id); count != 0 {
		t.Fatal("re-created copy readable")
	}
}

func TestMeetingDeleteRejectsBadRequests(t *testing.T) {
	host, _, sign := uploadHost(t)
	owner := copyOwner("delete-bad")
	for _, body := range []string{"", "{}", "[]", `{"meeting_id":"not-a-uuid"}`, `{"meeting_id":"72619a1d-f713-4f46-a2b8-c74e568726b1","extra":1}`,
		`{"meeting_id":"` + localMeeting + `"} trailing`} {
		if code, _ := meetingRequest(t, host.URL, sign(owner), "DELETE", body); code != 400 {
			t.Fatalf("delete body accepted: %d %q", code, body)
		}
	}
}

func TestMeetingUploadIsOwnerScoped(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner, other := copyOwner("scope-a"), copyOwner("scope-b")
	ownID, otherID := service.MeetingCopyID(owner, localMeeting), service.MeetingCopyID(other, localMeeting)
	if ownID == otherID {
		t.Fatal("one local Meeting mapped to one cloud copy for two accounts")
	}
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "Mine")); code != 200 {
		t.Fatal("owner upload")
	}
	if code, _ := meetingRequest(t, host.URL, sign(other), "POST", meetingDoc(localMeeting, 1, "Theirs")); code != 200 {
		t.Fatal("other upload")
	}
	assertSeparateCopies(t, reader, owner, other, ownID, otherID)
	// Another account cannot delete the first account's copy.
	if code, _ := meetingRequest(t, host.URL, sign(other), "DELETE", deleteBody(localMeeting)); code != 200 {
		t.Fatal("other delete")
	}
	if count, revision, _ := copyRow(t, reader, owner, ownID); count != 1 || revision != 1 {
		t.Fatalf("cross-owner delete touched the copy: %d %d", count, revision)
	}
	// A deletion of an identity that was never uploaded is indistinguishable and harmless.
	assertStrangerDelete(t, host, reader, sign, owner, ownID)
}

func assertStrangerDelete(t *testing.T, host *httptest.Server, reader *pgxpool.Pool, sign func(string) string, owner, ownID string) {
	t.Helper()
	stranger := copyOwner("scope-stranger")
	code, ack := meetingRequest(t, host.URL, sign(stranger), "DELETE", deleteBody(localMeeting))
	if code != 200 || ack["status"] != "deleted" {
		t.Fatalf("stranger delete: %d %v", code, ack)
	}
	if count, _, _ := copyRow(t, reader, owner, ownID); count != 1 {
		t.Fatal("stranger delete removed a copy")
	}
}

func assertSeparateCopies(t *testing.T, reader *pgxpool.Pool, owner, other, ownID, otherID string) {
	t.Helper()
	if count, _, _ := copyRow(t, reader, owner, ownID); count != 1 {
		t.Fatal("owner copy lost")
	}
	if count, _, _ := copyRow(t, reader, other, otherID); count != 1 {
		t.Fatal("other copy missing")
	}
	if count, _, _ := copyRow(t, reader, other, ownID); count != 0 {
		t.Fatal("cross-owner read")
	}
}

func marked(t *testing.T, reader *pgxpool.Pool, owner, id string) bool {
	t.Helper()
	tx, err := reader.BeginTx(context.Background(), pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		t.Fatal(err)
	}
	var deleted bool
	if err = tx.QueryRow(context.Background(),
		`SELECT deleted_at IS NOT NULL FROM meeting_lifecycle WHERE id=$1 AND owner_id=$2`, id, owner).Scan(&deleted); err != nil {
		t.Fatal(err)
	}
	return deleted
}
