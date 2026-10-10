package service

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
	"github.com/lestrrat-go/jwx/v3/jwk"
)

func testAuth(t *testing.T) (*Auth, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	public, _ := jwk.Import(&key.PublicKey)
	public.Set(jwk.KeyIDKey, "test")
	set := jwk.NewSet()
	set.AddKey(public)
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/jwks.json" {
			t.Error("unexpected JWKS path")
		}
		json.NewEncoder(w).Encode(set)
	}))
	t.Cleanup(host.Close)
	return &Auth{Issuer: host.URL, Resource: "https://example.test/mcp", Keys: NewKeys(host.URL)}, key
}

func tokenFor(t *testing.T, a *Auth, key *rsa.PrivateKey, change func(jwt.MapClaims)) string {
	t.Helper()
	c := jwt.MapClaims{"iss": a.Issuer, "sub": "user_synthetic", "aud": a.Resource,
		"exp": time.Now().Add(time.Hour).Unix(), "scope": Scope}
	if change != nil {
		change(c)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	token.Header["kid"], token.Header["typ"] = "test", "at+jwt"
	raw, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestAuthBoundaries(t *testing.T) {
	a, key := testAuth(t)
	if _, err := a.Keys.lookup(context.Background(), "test"); err != nil {
		t.Fatal(err)
	}
	cases := invalidClaims(a)
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := a.verify(context.Background(), tokenFor(t, a, key, change)); err == nil {
				t.Fatal("accepted")
			}
		})
	}
	for _, change := range []func(jwt.MapClaims){nil, func(c jwt.MapClaims) { c["scp"] = []string{Scope} }} {
		if _, err := a.verify(context.Background(), tokenFor(t, a, key, change)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestHTTPAuth(t *testing.T) {
	a, key := testAuth(t)
	handler := bounded(a.protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })))
	for _, tc := range []struct {
		raw    string
		status int
	}{
		{"", 401}, {"invalid", 401}, {tokenFor(t, a, key, nil), 204},
		{tokenFor(t, a, key, func(c jwt.MapClaims) { c["scope"] = "other" }), 403},
	} {
		req := httptest.NewRequest("POST", "/mcp", nil)
		if tc.raw != "" {
			req.Header.Set("Authorization", "Bearer "+tc.raw)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("status %d want %d", res.Code, tc.status)
		}
		checkAuthHeaders(t, res, a, tc.status)
	}
}

func TestUntrustedSigning(t *testing.T) {
	a, key := testAuth(t)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	if _, err := a.verify(context.Background(), tokenFor(t, a, other, nil)); err == nil {
		t.Fatal("wrong key accepted")
	}
	for _, typ := range []string{"JWT", ""} {
		raw := tokenFor(t, a, key, nil)
		parsed, _, _ := jwt.NewParser().ParseUnverified(raw, jwt.MapClaims{})
		parsed.Header["typ"] = typ
		raw, _ = parsed.SignedString(key)
		if _, err := a.verify(context.Background(), raw); err == nil {
			t.Fatal("ID/session token accepted")
		}
	}
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"iss": a.Issuer})
	raw, _ := hs.SignedString([]byte("synthetic"))
	if _, err := a.verify(context.Background(), raw); err == nil {
		t.Fatal("HMAC accepted")
	}
}

func invalidClaims(a *Auth) map[string]func(jwt.MapClaims) {
	return map[string]func(jwt.MapClaims){
		"expired":           func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Second).Unix() },
		"missing expiry":    func(c jwt.MapClaims) { delete(c, "exp") },
		"future":            func(c jwt.MapClaims) { c["nbf"] = time.Now().Add(time.Hour).Unix() },
		"audience":          func(c jwt.MapClaims) { c["aud"] = "https://other.test/mcp" },
		"missing audience":  func(c jwt.MapClaims) { delete(c, "aud") },
		"multiple audience": func(c jwt.MapClaims) { c["aud"] = []string{a.Resource, "other"} },
		"issuer":            func(c jwt.MapClaims) { c["iss"] = "https://evil.test" },
		"subject":           func(c jwt.MapClaims) { c["sub"] = "" },
		"scope":             func(c jwt.MapClaims) { c["scope"] = "meetings:sync" },
		"no scope":          func(c jwt.MapClaims) { delete(c, "scope") },
		"bad scp":           func(c jwt.MapClaims) { c["scp"] = Scope },
		"bad scope":         func(c jwt.MapClaims) { c["scope"] = []string{Scope} },
	}
}

func checkAuthHeaders(t *testing.T, res *httptest.ResponseRecorder, a *Auth, status int) {
	t.Helper()
	if status != 204 && !strings.Contains(res.Header().Get("WWW-Authenticate"), a.ResourceMetadata()) {
		t.Fatal("missing challenge")
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("cache enabled")
	}
}
