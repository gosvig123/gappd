package service_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/admin"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func database(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_ADMIN_DATABASE_URL")
	if url == "" {
		t.Skip("real PostgreSQL requires TEST_ADMIN_DATABASE_URL and TEST_DATABASE_URL")
	}
	conn, err := pgx.Connect(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	prepareDatabase(t, conn)
	pool, err := service.OpenPool(context.Background(), os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// The read tests share one owned copy that the administrator inserts through the same lifecycle
// rules an accepted upload follows. Each test process uses its own owner, so a rerun against the
// same database never sees another run's copies.
const seededLocalID = "seeded-meeting"

var seededOwner = fmt.Sprintf("user_seeded_%d", time.Now().UnixNano())
var seededMeetingID = service.MeetingCopyID(seededOwner, seededLocalID)

func seedMeeting(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	// The database clock, not the test host's, decides acceptance, as it does for an upload.
	mustExec(t, conn, `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 VALUES($1,$2,$3,statement_timestamp(),statement_timestamp()+interval '720 hours') ON CONFLICT DO NOTHING`,
		seededMeetingID, seededOwner, seededLocalID)
	mustExec(t, conn, `INSERT INTO cloud_meetings VALUES($1,$2,'Demo planning Meeting',
 'Participants agreed to review a fictional prototype.',
 E'[00:00] Speaker: This is fabricated test data.\n[00:05] Speaker: Review the fictional prototype next week.',
 '2026-09-13T12:00:00Z','2026-09-13T12:00:00Z',1,'{}') ON CONFLICT DO NOTHING`, seededMeetingID, seededOwner)
}

func lifecycleAdmin(t *testing.T) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), os.Getenv("TEST_ADMIN_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn
}

func mustExec(t *testing.T, conn *pgx.Conn, sql string, args ...any) {
	t.Helper()
	if _, err := conn.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func TestDatabaseIsolation(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	for range 8 {
		m, err := service.Read(ctx, pool, seededOwner, seededMeetingID)
		if err != nil || m.Title != "Demo planning Meeting" {
			t.Fatalf("owned read: %v", err)
		}
		_, other := service.Read(ctx, pool, "user_other", seededMeetingID)
		_, missing := service.Read(ctx, pool, "user_other", "00000000-0000-0000-0000-000000000000")
		if other == nil || missing == nil || other.Error() != missing.Error() {
			t.Fatal("owner leak")
		}
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM cloud_meetings`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("RLS/pool leak: %d %v", count, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM cloud_meetings`); err == nil {
		t.Fatal("runtime write allowed")
	}
	if _, err := service.Read(ctx, pool, seededOwner, "not-a-uuid"); err == nil {
		t.Fatal("bad ID allowed")
	}
}

type bearerTransport struct{ token *string }

func (b bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+*b.token)
	return http.DefaultTransport.RoundTrip(r)
}

func connect(t *testing.T, endpoint string, token *string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "synthetic-test", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: endpoint,
		HTTPClient: &http.Client{Transport: bearerTransport{token}}, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}

func TestMCP(t *testing.T) {
	pool := database(t)
	a, sign := signer(t)
	host := httptest.NewServer(service.Handler(a, pool))
	defer host.Close()
	token := sign(seededOwner)
	session := connect(t, host.URL+"/mcp", &token)
	assertTools(t, session)
	callMeeting(t, session, seededMeetingID, false)
	callMeeting(t, session, "bad-id", true)
	token = sign("user_other")
	callMeeting(t, session, seededMeetingID, true)
	token = "invalid"
	if _, err := session.ListTools(context.Background(), nil); err == nil {
		t.Fatal("request reused prior identity")
	}
	checkPayload(t, host.URL, sign(seededOwner))
}

func assertTools(t *testing.T, session *mcp.ClientSession) {
	t.Helper()
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(tools.Tools))
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	if strings.Join(names, ",") != "get_meeting,list_meetings,search_meetings" {
		t.Fatalf("tools: %v", names)
	}
}

func callMeeting(t *testing.T, s *mcp.ClientSession, id string, wantError bool) {
	t.Helper()
	result, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: "get_meeting", Arguments: map[string]any{"id": id}})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError != wantError {
		t.Fatalf("unexpected tool result: %v", result)
	}
	if !wantError && !strings.Contains(result.Content[0].(*mcp.TextContent).Text, `"title":"Demo planning Meeting"`) {
		t.Fatal("missing Meeting title")
	}
}

func checkPayload(t *testing.T, endpoint, token string) {
	t.Helper()
	req, _ := http.NewRequest("POST", endpoint+"/mcp", strings.NewReader(strings.Repeat("x", service.MaxBody+1)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 413 {
		t.Fatalf("payload status %d", res.StatusCode)
	}
}

func prepareDatabase(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	for range 2 {
		if err := admin.Migrate(context.Background(), conn); err != nil {
			t.Fatal(err)
		}
	}
	provisionRole(t, &readerOnce, func(ctx context.Context, conn *pgx.Conn) error {
		return admin.Provision(ctx, conn, "synthetic-test-password-only")
	})
	seedMeeting(t, conn)
}
