package service_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// limitedHost serves the read and write routes with a tiny request budget.
func limitedHost(t *testing.T) (*httptest.Server, *pgxpool.Pool, func(string) string) {
	t.Helper()
	reader, writer := meetingDatabase(t)
	auth, sign := signerScopes(t, service.Scope, "pi")
	auth.Limits = service.NewLimiter()
	auth.Limits.ReadBurst, auth.Limits.WriteBurst = 2, 2
	host := httptest.NewServer(service.HandlerWithUploads(auth, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	t.Cleanup(host.Close)
	return host, reader, sign
}

// The read budget counts requests to the MCP endpoint, not tool calls, so it is asserted at the
// transport. An SDK session spends part of the budget on initialize and tools/list.
func TestReadBudgetReturnsTooManyRequests(t *testing.T) {
	host, _, sign := limitedHost(t)
	token := sign(copyOwner("limit-read"))
	codes := []int{}
	for i := 0; i < 4; i++ {
		request, err := http.NewRequest("POST", host.URL+"/mcp", strings.NewReader("{}"))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Accept", "application/json, text/event-stream")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		codes = append(codes, response.StatusCode)
	}
	if codes[0] == 429 || codes[1] == 429 {
		t.Fatalf("budget refused a request inside the burst: %v", codes)
	}
	if codes[3] != 429 {
		t.Fatalf("budget did not refuse the fourth request: %v", codes)
	}
}

func TestWriteBudgetReturnsTooManyRequests(t *testing.T) {
	reader, writer := meetingDatabase(t)
	auth, sign := signerScopes(t, "meetings:sync", "desktop")
	auth.Limits = service.NewLimiter()
	auth.Limits.ReadBurst, auth.Limits.WriteBurst = 5, 2
	host := httptest.NewServer(service.HandlerWithUploads(auth, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	t.Cleanup(host.Close)
	token := sign(copyOwner("limit-write"))
	body := meetingDoc(localMeeting, 1, "Weekly sync")
	if code, _ := meetingRequest(t, host.URL, token, "POST", body); code != 200 {
		t.Fatalf("first upload: %d", code)
	}
	if code, _ := meetingRequest(t, host.URL, token, "POST", body); code != 429 {
		t.Fatalf("second upload should be rate limited, got %d", code)
	}
}

func TestAccountStorageLimitIsReported(t *testing.T) {
	const filler = "f1111111-0000-4000-8000-000000000001"
	reader, writer := meetingDatabase(t)
	auth, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithUploads(auth, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	t.Cleanup(host.Close)
	owner := copyOwner("storage-cap")
	fillAccount(t, owner)
	assertAccountFilled(t, owner, filler)
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(localMeeting, 1, "Weekly sync")); code != 413 {
		t.Fatalf("a full account should report 413, got %d", code)
	}
	// A revision of a copy the account already holds still fits at the cap.
	if code, _ := meetingRequest(t, host.URL, sign(owner), "POST", meetingDoc(filler, 2, "filler")); code != 200 {
		t.Fatalf("a revision update at the cap should pass, got %d", code)
	}
}

// fillAccount writes the copy cap in cheap rows, so the test does not upload 500 documents.
func fillAccount(t *testing.T, owner string) {
	t.Helper()
	conn := lifecycleAdmin(t)
	fixtureTx(t, conn, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `ALTER TABLE cloud_meetings DISABLE TRIGGER guard_cloud_meeting_insert`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 SELECT meeting_copy_id($1,'f1111111-0000-4000-8000-'||lpad(n::text,12,'0')),$1,
 'f1111111-0000-4000-8000-'||lpad(n::text,12,'0'),now(),now()+interval '720 hours' FROM generate_series(1,500) n`, owner); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO cloud_meetings(id,owner_id,title,summary,transcript,started_at,updated_at,revision,document)
 SELECT id,owner_id,'filler','','',now(),now(),1,'{"version":1}'::jsonb FROM meeting_lifecycle WHERE owner_id=$1`, owner); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `ALTER TABLE cloud_meetings ENABLE TRIGGER guard_cloud_meeting_insert`)
		return err
	})
}

func assertAccountFilled(t *testing.T, owner, filler string) {
	t.Helper()
	var fills, matched int
	conn := lifecycleAdmin(t)
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM cloud_meetings WHERE owner_id=$1`, owner).Scan(&fills); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(context.Background(), `SELECT count(*) FROM cloud_meetings WHERE owner_id=$1 AND id=meeting_copy_id($1,$2)`, owner, filler).Scan(&matched); err != nil {
		t.Fatal(err)
	}
	if fills != 500 || matched != 1 {
		t.Fatalf("fixtures wrong: fills=%d matched=%d", fills, matched)
	}
}
