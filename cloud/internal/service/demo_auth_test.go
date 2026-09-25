package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

func TestDeleteRouteRequiresSignedDesktopSyncAndEmptyBody(t *testing.T) {
	a, key := testAuth(t)
	handler := HandlerWithDemo(a, nil, &pgxpool.Pool{}, "desktop")
	for _, claims := range []struct {
		scope, client string
		want          int
	}{
		{Scope, "desktop", 403}, {"meetings:sync", "pi", 401}, {"meetings:sync", "", 401}, {"meetings:sync", "desktop", 400},
	} {
		raw := tokenFor(t, a, key, func(c jwt.MapClaims) { c["scope"], c["client_id"] = claims.scope, claims.client })
		request := httptest.NewRequest("DELETE", "/demo-meeting", strings.NewReader(`{"revision":999999}`))
		request.Header.Set("Authorization", "Bearer "+raw)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != claims.want {
			t.Fatalf("delete auth: got %d want %d", response.Code, claims.want)
		}
	}
	response := httptest.NewRecorder()
	Handler(a, nil).ServeHTTP(response, httptest.NewRequest("DELETE", "/demo-meeting", nil))
	if response.Code != 404 {
		t.Fatal("disabled deletion route available")
	}
}
