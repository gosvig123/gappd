package service_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/lestrrat-go/jwx/v3/jwk"
)

func signer(t *testing.T) (*service.Auth, func(string) string) {
	return signerScopes(t, service.Scope, "")
}

func signerScopes(t *testing.T, scope, clientID string) (*service.Auth, func(string) string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pub, _ := jwk.Import(&key.PublicKey)
	pub.Set(jwk.KeyIDKey, "synthetic")
	set := jwk.NewSet()
	set.AddKey(pub)
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(set) }))
	t.Cleanup(host.Close)
	a := &service.Auth{Issuer: host.URL, Resource: "https://example.test/mcp", Keys: service.NewKeys(host.URL)}
	return a, func(owner string) string {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": a.Issuer, "aud": a.Resource, "sub": owner,
			"exp": time.Now().Add(time.Hour).Unix(), "scp": []string{scope}, "client_id": clientID})
		token.Header["kid"], token.Header["typ"] = "synthetic", "at+jwt"
		raw, err := token.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
}
