package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// meetingDoc builds one valid version-1 document for a local Meeting.
func meetingDoc(localID string, revision int, title string) string {
	return fmt.Sprintf(`{"version":1,"meeting_id":%q,"revision":%d,"title":%q,`+
		`"started_at":"2026-09-14T12:00:00Z","ended_at":"2026-09-14T12:31:00Z","summary":"Prototype review.",`+
		`"speakers":[{"key":"You","label":"Kristian"}],`+
		`"turns":[{"start_sec":0,"end_sec":4.5,"speaker_key":"You","text":"Hello."}]}`, localID, revision, title)
}

const localMeeting = "72619a1d-f713-4f46-a2b8-c74e568726b1"

// uploadHost serves the real-copy routes with the writer pool and a signed desktop client.
func uploadHost(t *testing.T) (*httptest.Server, *pgxpool.Pool, func(string) string) {
	t.Helper()
	reader, writer := meetingDatabase(t)
	a, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithUploads(a, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	t.Cleanup(host.Close)
	return host, reader, sign
}

func meetingRequest(t *testing.T, host, token, method, body string) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(method, host+"/meeting", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	value := map[string]any{}
	if response.StatusCode == 200 {
		if err = json.NewDecoder(response.Body).Decode(&value); err != nil {
			t.Fatal(err)
		}
	}
	return response.StatusCode, value
}

// copyRow reads one copy as the reader role. Absent, deleted and expired copies count 0.
func copyRow(t *testing.T, reader *pgxpool.Pool, owner, id string) (int, int, string) {
	t.Helper()
	tx, err := reader.BeginTx(context.Background(), pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		t.Fatal(err)
	}
	var count, revision int
	var expiry string
	err = tx.QueryRow(context.Background(), `SELECT count(*),coalesce(max(revision),0),coalesce(max(expires_at)::text,'')
 FROM (SELECT m.revision,l.expires_at FROM cloud_meetings m
 JOIN meeting_lifecycle l ON l.id=m.id AND l.owner_id=m.owner_id
 WHERE m.id=$1 AND m.owner_id=$2) s`, id, owner).Scan(&count, &revision, &expiry)
	if err != nil {
		t.Fatal(err)
	}
	return count, revision, expiry
}

func TestMeetingUploadRoundTrip(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner := copyOwner("upload")
	id := service.MeetingCopyID(owner, localMeeting)
	code, ack := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "Weekly sync"))
	if code != 200 || ack["status"] != "accepted" || ack["id"] != id || ack["subject"] != owner {
		t.Fatalf("upload: %d %v", code, ack)
	}
	if ack["revision"] != float64(1) || ack["expires_at"] == nil {
		t.Fatalf("ack fields: %v", ack)
	}
	count, revision, expiry := copyRow(t, reader, owner, id)
	if count != 1 || revision != 1 || expiry == "" {
		t.Fatalf("stored: %d %d %q", count, revision, expiry)
	}
	// A retry is harmless and must not move the fixed expiry.
	_, retry := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "Weekly sync"))
	if retry["revision"] != float64(1) || retry["expires_at"] != ack["expires_at"] {
		t.Fatalf("retry extended the copy: %v %v", ack["expires_at"], retry["expires_at"])
	}
}

func TestMeetingUploadRevisionRules(t *testing.T) {
	host, reader, sign := uploadHost(t)
	owner := copyOwner("upload-revision")
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "First")); code != 200 {
		t.Fatal("first upload")
	}
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 2, "Second")); code != 200 {
		t.Fatal("second upload")
	}
	if _, revision, _ := copyRow(t, reader, owner, id); revision != 2 {
		t.Fatalf("revision: %d", revision)
	}
	// An older revision is accepted but changes nothing.
	code, ack := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "First"))
	if code != 200 || ack["revision"] != float64(2) {
		t.Fatalf("stale upload: %d %v", code, ack)
	}
	if _, revision, _ := copyRow(t, reader, owner, id); revision != 2 {
		t.Fatalf("stale upload overwrote: %d", revision)
	}
	// One revision must mean one document.
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 2, "Different")); code == 200 {
		t.Fatal("conflicting revision accepted")
	}
}

func TestMeetingUploadRejectsBadRequests(t *testing.T) {
	host, _, sign := uploadHost(t)
	owner := copyOwner("upload-bad")
	_, readSign := signerScopes(t, "meetings:read", "desktop")
	invalid := []string{
		"", "{}", "[]", meetingDoc(localMeeting, 1, "x")[:40],
		strings.Replace(meetingDoc(localMeeting, 1, "x"), `"summary"`, `"audio_path"`, 1),
		meetingDoc("not-a-uuid", 1, "x"),
		meetingDoc(localMeeting, 0, "x"),
		strings.Repeat("x", service.MaxDocumentBytes+1),
	}
	for index, body := range invalid {
		if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", body); code != 400 {
			t.Fatalf("invalid body %d accepted: %d", index, code)
		}
	}
	valid := meetingDoc(localMeeting, 1, "x")
	if code, _ := meetingRequest(t, host.URL, readSign(owner), "POST", valid); code == 200 {
		t.Fatal("read scope uploaded")
	}
	if code, _ := meetingRequest(t, host.URL, "invalid", "POST", valid); code != 401 {
		t.Fatalf("invalid token: %d", code)
	}
}

func TestMeetingUploadNeedsTheDesktopClient(t *testing.T) {
	reader, writer := meetingDatabase(t)
	a, sign := signerScopes(t, "meetings:sync", "other-client")
	host := httptest.NewServer(service.HandlerWithUploads(a, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	defer host.Close()
	if code, _ := meetingRequest(t, host.URL, sign(copyOwner("wrong-client")), "POST", meetingDoc(localMeeting, 1, "x")); code == 200 {
		t.Fatal("wrong client uploaded")
	}
}
