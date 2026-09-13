package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestDemoAuth(t *testing.T) {
	a, key := testAuth(t)
	a.RequiredScope, a.ClientID = "meetings:sync", "desktop"
	for _, client := range []any{nil, "", "pi", []string{"desktop"}, "desktop"} {
		for _, scope := range []string{Scope, "meetings:sync"} {
			raw := tokenFor(t, a, key, func(c jwt.MapClaims) { c["scope"], c["client_id"] = scope, client })
			_, err := a.verify(context.Background(), raw)
			want := client == "desktop" && scope == "meetings:sync"
			if (err == nil) != want {
				t.Fatalf("client %v scope %s accepted=%v", client, scope, err == nil)
			}
		}
	}
}

func TestDemoRejectsAllBodyContent(t *testing.T) {
	handler := demoHandler(nil)
	for _, body := range []string{" ", "{}", `{"synthetic":true,"title":"private"}`, strings.Repeat("x", MaxBody+1)} {
		for _, length := range []int64{-1, int64(len(body))} {
			request := httptest.NewRequest("POST", "/demo-meeting", strings.NewReader(body))
			request.ContentLength = length
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("body accepted: %d", response.Code)
			}
		}
	}
}

func TestDemoDisabledAndReadDiscoveryUnchanged(t *testing.T) {
	a, _ := testAuth(t)
	handler := Handler(a, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("POST", "/demo-meeting", nil))
	if response.Code != 404 {
		t.Fatalf("demo enabled: %d", response.Code)
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/.well-known/oauth-protected-resource", nil))
	if strings.Contains(response.Body.String(), "meetings:sync") {
		t.Fatal("sync scope advertised")
	}
}
