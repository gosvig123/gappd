package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPublicRoutes(t *testing.T) {
	a, _ := testAuth(t)
	h := Handler(a, nil)
	for _, path := range []string{"/health", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		if res.Code != 200 {
			t.Fatalf("%s: %d", path, res.Code)
		}
		if path == "/health" {
			continue
		}
		var metadata map[string]any
		if err := json.Unmarshal(res.Body.Bytes(), &metadata); err != nil {
			t.Fatal(err)
		}
		if metadata["resource"] != a.Resource || strings.Contains(res.Body.String(), "meetings:sync") {
			t.Fatal("wrong metadata")
		}
	}
}

func TestQueryTokenRejected(t *testing.T) {
	a, _ := testAuth(t)
	h := Handler(a, nil)
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest("GET", "/mcp?access_token=synthetic", nil))
	if res.Code != 400 {
		t.Fatal("query token accepted")
	}
}

func TestKeyFetchBounds(t *testing.T) {
	calls := 0
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Write([]byte(strings.Repeat("x", maxJWKSBytes+1)))
	}))
	defer host.Close()
	keys := NewKeys(host.URL)
	for range 3 {
		if _, err := keys.lookup(context.Background(), "unknown"); err == nil {
			t.Fatal("invalid keys accepted")
		}
	}
	if calls != 1 {
		t.Fatal("failure cache missing")
	}
	keys.next = time.Time{}
	keys.Client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if _, err := keys.lookup(context.Background(), "unknown"); err == nil || calls != 2 {
		t.Fatal("cache expiry")
	}
}

func TestKeyRedirectRejected(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("followed redirect") }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer source.Close()
	if _, err := NewKeys(source.URL).lookup(context.Background(), "key"); err == nil {
		t.Fatal("redirect accepted")
	}
}
