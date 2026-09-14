package service_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lestrrat-go/jwx/v3/jwk"
)

type tokenMinter func(scope, client, subject string) string

// revokeAuth builds one identity that can mint a token for any scope and client, so a test can
// hold a read token and a sync token for the same server.
func revokeAuth(t *testing.T) (*service.Auth, tokenMinter) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	public, _ := jwk.Import(&key.PublicKey)
	public.Set(jwk.KeyIDKey, "synthetic")
	set := jwk.NewSet()
	set.AddKey(public)
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(set)
	}))
	t.Cleanup(jwks.Close)
	a := &service.Auth{Issuer: jwks.URL, Resource: "https://example.test/mcp", Keys: service.NewKeys(jwks.URL)}
	return a, func(scope, client, subject string) string {
		claims := jwt.MapClaims{"iss": a.Issuer, "aud": a.Resource, "sub": subject,
			"exp": time.Now().Add(time.Hour).Unix(), "scp": []string{scope}, "client_id": client}
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		token.Header["kid"], token.Header["typ"] = "synthetic", "at+jwt"
		raw, err := token.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
}

// revokeHost serves both classes with the revocation check enabled.
func revokeHost(t *testing.T, ttl time.Duration) (*httptest.Server, *pgxpool.Pool, *pgxpool.Pool, tokenMinter) {
	t.Helper()
	reader, writer := meetingDatabase(t)
	auth, mint := revokeAuth(t)
	auth.Revocations = service.NewRevocations(reader)
	auth.Revocations.TTL = ttl
	host := httptest.NewServer(service.HandlerWithUploads(auth, reader, service.Uploads{Meeting: writer, ClientID: "desktop"}))
	t.Cleanup(host.Close)
	return host, reader, writer, mint
}

// mcpStatus posts to the MCP endpoint and reports the transport status.
func mcpStatus(t *testing.T, host, token string) int {
	t.Helper()
	request, err := http.NewRequest("POST", host+"/mcp", strings.NewReader("{}"))
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
	return response.StatusCode
}

func postRevoke(t *testing.T, host, syncToken, body string) int {
	t.Helper()
	request, err := http.NewRequest("POST", host+"/revoke", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if syncToken != "" {
		request.Header.Set("Authorization", "Bearer "+syncToken)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	return response.StatusCode
}

func revokeClient(t *testing.T, host, syncToken, client string) int {
	t.Helper()
	return postRevoke(t, host, syncToken, `{"client_id":"`+client+`"}`)
}

func TestRevokedClientIsRefused(t *testing.T) {
	host, _, _, mint := revokeHost(t, 0)
	owner := copyOwner("revoke")
	revokedToken := mint(service.Scope, "pi", owner)
	if code := mcpStatus(t, host.URL, revokedToken); code == 401 {
		t.Fatal("a valid token was refused before revocation")
	}
	if code := revokeClient(t, host.URL, mint("meetings:sync", "desktop", owner), "pi"); code != 200 {
		t.Fatalf("revoke returned %d", code)
	}
	if code := mcpStatus(t, host.URL, revokedToken); code != 401 {
		t.Fatalf("revoked client still served: %d", code)
	}
	// Only that client was cut off.
	if code := mcpStatus(t, host.URL, mint(service.Scope, "chatgpt", owner)); code == 401 {
		t.Fatal("revoking one client refused another")
	}
}

func TestRevocationIsPerAccount(t *testing.T) {
	host, _, _, mint := revokeHost(t, 0)
	owner, other := copyOwner("revoke-a"), copyOwner("revoke-b")
	if code := revokeClient(t, host.URL, mint("meetings:sync", "desktop", owner), "pi"); code != 200 {
		t.Fatalf("revoke returned %d", code)
	}
	if code := mcpStatus(t, host.URL, mint(service.Scope, "pi", owner)); code != 401 {
		t.Fatal("the revoked account was served")
	}
	if code := mcpStatus(t, host.URL, mint(service.Scope, "pi", other)); code == 401 {
		t.Fatal("revoking one account affected another")
	}
}

func TestAnyClientRevocationCoversEveryClient(t *testing.T) {
	host, _, _, mint := revokeHost(t, 0)
	owner := copyOwner("revoke-any")
	if code := revokeClient(t, host.URL, mint("meetings:sync", "desktop", owner), service.AnyClient); code != 200 {
		t.Fatalf("revoke returned %d", code)
	}
	for _, client := range []string{"pi", "chatgpt", "desktop"} {
		if code := mcpStatus(t, host.URL, mint(service.Scope, client, owner)); code != 401 {
			t.Fatalf("client %s survived an account-wide revocation: %d", client, code)
		}
	}
}

func TestRevokeRouteNeedsTheDesktopClientAndSyncScope(t *testing.T) {
	host, _, _, mint := revokeHost(t, 0)
	owner := copyOwner("revoke-auth")
	body := `{"client_id":"pi"}`
	cases := []struct{ name, token string }{
		{"read scope", mint(service.Scope, "desktop", owner)},
		{"wrong client", mint("meetings:sync", "other-client", owner)},
		{"no token", ""},
	}
	for _, test := range cases {
		if status := postRevoke(t, host.URL, test.token, body); status == 200 {
			t.Fatalf("%s was allowed to revoke", test.name)
		}
	}
	if code := mcpStatus(t, host.URL, mint(service.Scope, "pi", owner)); code == 401 {
		t.Fatal("a refused revoke still revoked the client")
	}
}

func TestRevocationAnswerIsCachedForItsTTL(t *testing.T) {
	host, _, writer, mint := revokeHost(t, time.Hour)
	owner := copyOwner("revoke-cache")
	token := mint(service.Scope, "pi", owner)
	if code := mcpStatus(t, host.URL, token); code == 401 {
		t.Fatal("refused before revocation")
	}
	// Revoke behind the running server's back: its cached answer is what the next request sees.
	if err := service.RevokeGrant(context.Background(), writer, owner, "pi"); err != nil {
		t.Fatal(err)
	}
	if code := mcpStatus(t, host.URL, token); code == 401 {
		t.Fatal("a cached answer did not hold for its TTL")
	}
	// A fresh check sees it, which is what a restart or the TTL expiry does.
	fresh := service.NewRevocations(writer)
	if revoked, err := fresh.Revoked(context.Background(), owner, "pi"); err != nil || !revoked {
		t.Fatalf("fresh check: revoked=%v err=%v", revoked, err)
	}
	if revoked, err := fresh.Revoked(context.Background(), owner, "chatgpt"); err != nil || revoked {
		t.Fatalf("other client: revoked=%v err=%v", revoked, err)
	}
}
