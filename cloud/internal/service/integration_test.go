package service_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

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

func TestDatabaseIsolation(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	for range 8 {
		m, err := service.Read(ctx, pool, "user_synthetic", service.DemoID)
		if err != nil || !m.Synthetic {
			t.Fatalf("owned read: %v", err)
		}
		_, other := service.Read(ctx, pool, "user_other", service.DemoID)
		_, missing := service.Read(ctx, pool, "user_other", "00000000-0000-0000-0000-000000000000")
		if other == nil || missing == nil || other.Error() != missing.Error() {
			t.Fatal("owner leak")
		}
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM meetings`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("RLS/pool leak: %d %v", count, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM meetings`); err == nil {
		t.Fatal("runtime write allowed")
	}
	if _, err := service.Read(ctx, pool, "user_synthetic", "not-a-uuid"); err == nil {
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
	token := sign("user_synthetic")
	session := connect(t, host.URL+"/mcp", &token)
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
	callMeeting(t, session, service.DemoID, false)
	callMeeting(t, session, "bad-id", true)
	token = sign("user_other")
	callMeeting(t, session, service.DemoID, true)
	token = "invalid"
	if _, err = session.ListTools(context.Background(), nil); err == nil {
		t.Fatal("request reused prior identity")
	}
	checkPayload(t, host.URL, sign("user_synthetic"))
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
	if !wantError && !strings.Contains(result.Content[0].(*mcp.TextContent).Text, `"synthetic":true`) {
		t.Fatal("missing synthetic marker")
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
	if err := admin.Provision(context.Background(), conn, "synthetic-test-password-only"); err != nil {
		t.Fatal(err)
	}
	if err := admin.Seed(context.Background(), conn, "user_synthetic"); err != nil {
		t.Fatal(err)
	}
	if err := admin.Seed(context.Background(), conn, "user_other"); err == nil {
		t.Fatal("seed reassigned owner")
	}
}
