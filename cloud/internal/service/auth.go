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

// caller is the verified identity behind one request: the account and the client that was issued
// the token. A revocation is keyed on both, so one client can be cut off without the others.
type caller struct {
	owner  string
	client string
}

type Auth struct {
	Issuer, Resource        string
	Keys                    *Keys
	RequiredScope, ClientID string
	// Limits is installed by the server entrypoint. A nil limiter disables request budgets.
	Limits *Limiter
	// Revocations is installed by the server entrypoint. Nil disables the revocation check.
	Revocations *Revocations
	// Clients keeps the list of clients that have used each account. Nil disables recording.
	Clients *ClientDirectory
}

var errScope = errors.New("insufficient scope")
var errRevoked = errors.New("revoked grant")

func (a *Auth) verify(ctx context.Context, raw string) (caller, error) {
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
		return caller{}, errors.New("invalid token")
	}
	return a.identity(claims)
}

func (a *Auth) identity(claims jwt.MapClaims) (caller, error) {
	aud, _ := claims.GetAudience()
	sub, _ := claims.GetSubject()
	if len(aud) != 1 || aud[0] != a.Resource || strings.TrimSpace(sub) != sub || sub == "" || len(sub) > 256 {
		return caller{}, errors.New("invalid identity")
	}
	if a.ClientID != "" && claims["client_id"] != a.ClientID {
		return caller{}, errors.New("invalid client")
	}
	if !hasRequiredScope(claims, a.scope()) {
		return caller{}, errScope
	}
	// A token without a client claim is still covered by an account-wide revocation.
	client, _ := claims["client_id"].(string)
	if len(client) > 256 || strings.TrimSpace(client) != client {
		client = ""
	}
	return caller{owner: sub, client: client}, nil
}

// Clerk OAuthJwtPayload uses scp, or space-delimited scope when scp is absent.
func hasScope(c jwt.MapClaims) bool { return hasRequiredScope(c, Scope) }

func (a *Auth) scope() string {
	if a.RequiredScope != "" {
		return a.RequiredScope
	}
	return Scope
}

func hasRequiredScope(c jwt.MapClaims, required string) bool {
	if v, ok := c["scope"]; ok {
		if _, ok := v.(string); !ok {
			return false
		}
	}
	if v, ok := c["scp"]; ok {
		return scopeArray(v, required)
	}
	s, _ := c["scope"].(string)
	return slices.Contains(strings.Split(s, " "), required)
}

func (a *Auth) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fields := strings.Fields(r.Header.Get("Authorization"))
		var id caller
		var err error
		if len(fields) == 2 && strings.EqualFold(fields[0], "Bearer") && len(fields[1]) <= 16384 {
			id, err = a.verify(r.Context(), fields[1])
		} else {
			err = errors.New("missing token")
		}
		if err != nil {
			a.reject(w, err)
			return
		}
		if !a.grantAllowed(w, r, id) {
			return
		}
		// Best effort and off the hot path: a missed entry only means the id must be typed.
		a.Clients.Record(id.owner, id.client)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ownerKey{}, id.owner)))
	})
}

// limited applies the per-account request budget for one class of route. It must wrap the
// protected handler, so it can key on the verified account rather than on the caller's header.
func (a *Auth) limited(class string, next http.Handler) http.Handler {
	if a.Limits == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		owner, _ := r.Context().Value(ownerKey{}).(string)
		if !a.Limits.allow(class, owner) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// grantAllowed refuses a token whose client the account revoked. A lookup failure fails closed
// with 503, because the service cannot claim the token is bad when it cannot tell.
func (a *Auth) grantAllowed(w http.ResponseWriter, r *http.Request, id caller) bool {
	if a.Revocations == nil {
		return true
	}
	revoked, err := a.Revocations.Revoked(r.Context(), id.owner, id.client)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return false
	}
	if revoked {
		a.reject(w, errRevoked)
		return false
	}
	return true
}

func (a *Auth) reject(w http.ResponseWriter, err error) {
	status := http.StatusUnauthorized
	if errors.Is(err, errScope) {
		status = http.StatusForbidden
	}
	w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+a.ResourceMetadata()+`", scope="`+a.scope()+`"`)
	http.Error(w, http.StatusText(status), status)
}

func scopeArray(value any, required string) bool {
	values, ok := value.([]any)
	if !ok {
		return false
	}
	found := false
	for _, value := range values {
		scope, ok := value.(string)
		if !ok {
			return false
		}
		found = found || scope == required
	}
	return found
}
