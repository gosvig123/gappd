package service

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

const Scope = "meetings:read"

type ownerKey struct{}
type Auth struct {
	Issuer, Resource string
	Keys             *Keys
}

var errScope = errors.New("insufficient scope")

func (a *Auth) verify(ctx context.Context, raw string) (string, error) {
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		typ, _ := t.Header["typ"].(string)
		kid, _ := t.Header["kid"].(string)
		if (typ != "at+jwt" && typ != "application/at+jwt") || kid == "" {
			return nil, errors.New("not an access token")
		}
		return a.Keys.lookup(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(a.Issuer),
		jwt.WithAudience(a.Resource), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !token.Valid {
		return "", errors.New("invalid token")
	}
	aud, _ := claims.GetAudience()
	sub, _ := claims.GetSubject()
	if len(aud) != 1 || aud[0] != a.Resource || strings.TrimSpace(sub) != sub || sub == "" || len(sub) > 256 {
		return "", errors.New("invalid identity")
	}
	if !hasScope(claims) {
		return "", errScope
	}
	return sub, nil
}

// Clerk OAuthJwtPayload uses scp, or space-delimited scope when scp is absent.
func hasScope(c jwt.MapClaims) bool {
	if v, ok := c["scope"]; ok {
		if _, ok := v.(string); !ok {
			return false
		}
	}
	if v, ok := c["scp"]; ok {
		values, ok := v.([]any)
		if !ok {
			return false
		}
		found := false
		for _, v := range values {
			s, ok := v.(string)
			if !ok {
				return false
			}
			found = found || s == Scope
		}
		return found
	}
	s, _ := c["scope"].(string)
	return slices.Contains(strings.Split(s, " "), Scope)
}

func (a *Auth) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fields := strings.Fields(r.Header.Get("Authorization"))
		var owner string
		var err error
		if len(fields) == 2 && strings.EqualFold(fields[0], "Bearer") && len(fields[1]) <= 16384 {
			owner, err = a.verify(r.Context(), fields[1])
		} else {
			err = errors.New("missing token")
		}
		if err != nil {
			status := http.StatusUnauthorized
			if errors.Is(err, errScope) {
				status = http.StatusForbidden
			}
			w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+a.ResourceMetadata()+`", scope="`+Scope+`"`)
			http.Error(w, http.StatusText(status), status)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ownerKey{}, owner)))
	})
}
