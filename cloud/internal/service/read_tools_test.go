package service_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestListOwnedMeetings(t *testing.T) {
	pool := database(t)
	page, err := service.List(context.Background(), pool, "user_synthetic", service.ListParams{Limit: 20})
	if err != nil || len(page.Meetings) != 1 || page.Meetings[0].ID != service.DemoID || page.NextOffset != 0 {
		t.Fatalf("owned list: %v %v", page, err)
	}
	if page.Meetings[0].Title == "" || page.Meetings[0].StartedAt.IsZero() {
		t.Fatal("summary missing fields")
	}
	if other, err := service.List(context.Background(), pool, "user_other", service.ListParams{Limit: 20}); err != nil || len(other.Meetings) != 0 {
		t.Fatalf("owner leak: %v %v", other, err)
	}
}

func TestListDateFilters(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	after := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	if filtered, err := service.List(ctx, pool, "user_synthetic", service.ListParams{Limit: 20, Since: after}); err != nil || len(filtered.Meetings) != 0 {
		t.Fatalf("lower bound: %v %v", filtered, err)
	}
	before := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	if filtered, err := service.List(ctx, pool, "user_synthetic", service.ListParams{Limit: 20, Until: before}); err != nil || len(filtered.Meetings) != 0 {
		t.Fatalf("upper bound: %v %v", filtered, err)
	}
	at := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	if kept, err := service.List(ctx, pool, "user_synthetic", service.ListParams{Limit: 20, Since: at, Until: at.Add(time.Hour)}); err != nil || len(kept.Meetings) != 1 {
		t.Fatalf("inclusive lower bound: %v %v", kept, err)
	}
}

func TestListRejectsInvalidPages(t *testing.T) {
	pool := database(t)
	for _, bad := range []service.ListParams{{Limit: 0}, {Limit: 51}, {Limit: 20, Offset: -1}, {Limit: 20, Offset: 1001},
		{Limit: 20, Since: time.Now(), Until: time.Now().Add(-time.Hour)}} {
		if _, err := service.List(context.Background(), pool, "user_synthetic", bad); err == nil {
			t.Fatalf("page accepted: %+v", bad)
		}
	}
}

func TestListReportsNextPageOnlyWhenMoreRowsExist(t *testing.T) {
	pool := database(t)
	page, err := service.List(context.Background(), pool, "user_synthetic", service.ListParams{Limit: 1})
	if err != nil || len(page.Meetings) != 1 || page.NextOffset != 0 {
		t.Fatalf("list: %v %v", page, err)
	}
}

func TestSearchOwnedMeetings(t *testing.T) {
	pool := database(t)
	result, err := service.Search(context.Background(), pool, "user_synthetic", "fictional prototype", 10)
	if err != nil || len(result.Matches) != 1 || result.Matches[0].ID != service.DemoID {
		t.Fatalf("owned search: %v %v", result, err)
	}
	if !strings.Contains(result.Matches[0].Passage, "prototype") || strings.Contains(result.Matches[0].Passage, "<b>") {
		t.Fatalf("passage: %q", result.Matches[0].Passage)
	}
}

func TestSearchIsolatesOwnersAndInput(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	if empty, err := service.Search(ctx, pool, "user_synthetic", "zzyzxquux", 10); err != nil || len(empty.Matches) != 0 {
		t.Fatalf("absent term: %v %v", empty, err)
	}
	if other, err := service.Search(ctx, pool, "user_other", "fictional prototype", 10); err != nil || len(other.Matches) != 0 {
		t.Fatalf("owner leak: %v %v", other, err)
	}
	// Operator-like text must stay plain search text and must not reach SQL.
	if odd, err := service.Search(ctx, pool, "user_synthetic", `'; DROP TABLE meetings; --`, 10); err != nil || len(odd.Matches) != 0 {
		t.Fatalf("hostile query: %v %v", odd, err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM meetings`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("RLS leak after search: %d %v", count, err)
	}
}

func TestSearchRejectsInvalidInput(t *testing.T) {
	pool := database(t)
	for _, query := range []string{"", "   ", strings.Repeat("a", 201)} {
		if _, err := service.Search(context.Background(), pool, "user_synthetic", query, 10); err == nil {
			t.Fatalf("query accepted: %q", query)
		}
	}
	for _, limit := range []int{0, 26} {
		if _, err := service.Search(context.Background(), pool, "user_synthetic", "prototype", limit); err == nil {
			t.Fatalf("limit accepted: %d", limit)
		}
	}
}

func TestMCPReadTools(t *testing.T) {
	session := readSession(t, "user_synthetic")
	if text := toolText(t, session, "list_meetings", map[string]any{"limit": 5}); !strings.Contains(text, service.DemoID) {
		t.Fatalf("list: %s", text)
	}
	if text := toolText(t, session, "search_meetings", map[string]any{"query": "fictional prototype"}); !strings.Contains(text, service.DemoID) {
		t.Fatalf("search: %s", text)
	}
}

func TestMCPReadToolsRejectInvalidInput(t *testing.T) {
	session := readSession(t, "user_synthetic")
	for _, args := range []map[string]any{
		{"limit": 99}, {"since": "not-a-time"}, {"since": "2026-09-13T12:00:00Z", "until": "2026-09-13T11:00:00Z"},
	} {
		if result := callTool(t, session, "list_meetings", args); !result.IsError {
			t.Fatalf("list accepted %v", args)
		}
	}
	if result := callTool(t, session, "search_meetings", map[string]any{"query": ""}); !result.IsError {
		t.Fatal("empty query accepted")
	}
}

func TestMCPReadToolsIsolateOwners(t *testing.T) {
	session := readSession(t, "user_other")
	reads := []struct {
		name string
		args map[string]any
	}{
		{"list_meetings", map[string]any{"limit": 5}},
		{"search_meetings", map[string]any{"query": "fictional prototype"}},
	}
	for _, read := range reads {
		if text := toolText(t, session, read.name, read.args); strings.Contains(text, service.DemoID) {
			t.Fatalf("owner leak on %s: %s", read.name, text)
		}
	}
}

func readSession(t *testing.T, owner string) *mcp.ClientSession {
	t.Helper()
	a, sign := signer(t)
	host := httptest.NewServer(service.Handler(a, database(t)))
	t.Cleanup(host.Close)
	token := sign(owner)
	return connect(t, host.URL+"/mcp", &token)
}

func callTool(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return result
}

func toolText(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) string {
	t.Helper()
	result := callTool(t, session, name, args)
	if result.IsError {
		t.Fatalf("%s returned an error: %v", name, result)
	}
	return result.Content[0].(*mcp.TextContent).Text
}
