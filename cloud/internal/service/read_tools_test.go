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
	ctx := context.Background()
	page, err := service.List(ctx, pool, "user_synthetic", service.ListParams{Limit: 20})
	if err != nil || len(page.Meetings) != 1 || page.Meetings[0].ID != service.DemoID || page.NextOffset != 0 {
		t.Fatalf("owned list: %v %v", page, err)
	}
	if page.Meetings[0].Title == "" || page.Meetings[0].StartedAt.IsZero() {
		t.Fatal("summary missing fields")
	}
	if other, err := service.List(ctx, pool, "user_other", service.ListParams{Limit: 20}); err != nil || len(other.Meetings) != 0 {
		t.Fatalf("owner leak: %v %v", other, err)
	}
	after := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	if filtered, err := service.List(ctx, pool, "user_synthetic", service.ListParams{Limit: 20, Since: after}); err != nil || len(filtered.Meetings) != 0 {
		t.Fatalf("date filter: %v %v", filtered, err)
	}
	before := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	if filtered, err := service.List(ctx, pool, "user_synthetic", service.ListParams{Limit: 20, Until: before}); err != nil || len(filtered.Meetings) != 0 {
		t.Fatalf("upper bound: %v %v", filtered, err)
	}
	for _, bad := range []service.ListParams{{Limit: 0}, {Limit: 51}, {Limit: 20, Offset: -1}, {Limit: 20, Offset: 1001}} {
		if _, err := service.List(ctx, pool, "user_synthetic", bad); err == nil {
			t.Fatalf("page accepted: %+v", bad)
		}
	}
}

func TestListReportsNextPageOnlyWhenMoreRowsExist(t *testing.T) {
	pool := database(t)
	page, err := service.List(context.Background(), pool, "user_synthetic", service.ListParams{Limit: 1})
	if err != nil || len(page.Meetings) != 1 {
		t.Fatalf("list: %v %v", page, err)
	}
	if page.NextOffset != 0 {
		t.Fatalf("false next page: %d", page.NextOffset)
	}
}

func TestSearchOwnedMeetings(t *testing.T) {
	pool := database(t)
	ctx := context.Background()
	result, err := service.Search(ctx, pool, "user_synthetic", "fictional prototype", 10)
	if err != nil || len(result.Matches) != 1 || result.Matches[0].ID != service.DemoID {
		t.Fatalf("owned search: %v %v", result, err)
	}
	if !strings.Contains(result.Matches[0].Passage, "prototype") {
		t.Fatalf("passage: %q", result.Matches[0].Passage)
	}
	if empty, err := service.Search(ctx, pool, "user_synthetic", "zzyzxquux", 10); err != nil || len(empty.Matches) != 0 {
		t.Fatalf("absent term: %v %v", empty, err)
	}
	if other, err := service.Search(ctx, pool, "user_other", "fictional prototype", 10); err != nil || len(other.Matches) != 0 {
		t.Fatalf("owner leak: %v %v", other, err)
	}
	// A quoted or operator-like query must stay a plain text search, not reach SQL.
	if odd, err := service.Search(ctx, pool, "user_synthetic", `'; DROP TABLE meetings; --`, 10); err != nil || len(odd.Matches) != 0 {
		t.Fatalf("hostile query: %v %v", odd, err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM meetings`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("RLS leak after search: %d %v", count, err)
	}
	for _, query := range []string{"", "   ", strings.Repeat("a", 201)} {
		if _, err := service.Search(ctx, pool, "user_synthetic", query, 10); err == nil {
			t.Fatalf("query accepted: %q", query)
		}
	}
	if _, err := service.Search(ctx, pool, "user_synthetic", "prototype", 26); err == nil {
		t.Fatal("limit accepted")
	}
}

func TestMCPListAndSearchTools(t *testing.T) {
	pool := database(t)
	a, sign := signer(t)
	host := httptest.NewServer(service.Handler(a, pool))
	defer host.Close()
	token := sign("user_synthetic")
	session := connect(t, host.URL+"/mcp", &token)
	call := func(name string, args map[string]any) string {
		t.Helper()
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if result.IsError {
			t.Fatalf("%s returned an error: %v", name, result)
		}
		return result.Content[0].(*mcp.TextContent).Text
	}
	if text := call("list_meetings", map[string]any{"limit": 5}); !strings.Contains(text, service.DemoID) {
		t.Fatalf("list: %s", text)
	}
	if text := call("search_meetings", map[string]any{"query": "fictional prototype"}); !strings.Contains(text, service.DemoID) {
		t.Fatalf("search: %s", text)
	}
	token = sign("user_other")
	if text := call("list_meetings", map[string]any{}); strings.Contains(text, service.DemoID) {
		t.Fatalf("owner leak: %s", text)
	}
	if text := call("search_meetings", map[string]any{"query": "fictional prototype"}); strings.Contains(text, service.DemoID) {
		t.Fatalf("owner leak: %s", text)
	}
}
