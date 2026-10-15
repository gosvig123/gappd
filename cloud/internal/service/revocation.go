package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxRevokeBody bounds the small body that names one client.
const MaxRevokeBody = 256

// AnyClient revokes every client of one account, including a token that carries no client claim.
const AnyClient = "*"

// revocationTTL bounds how long a revoked client may keep working, and how long an unrevoked
// answer is trusted, so every request does not cost a database round trip.
// ponytail: one process-local cache, move it to a shared store before running more than one instance.
const revocationTTL = 30 * time.Second

type revocationEntry struct {
	revoked bool
	at      time.Time
}

// Revocations answers whether one account has revoked a client's access.
type Revocations struct {
	// TTL bounds how long one answer is trusted. 0 checks the database on every request.
	TTL   time.Duration
	pool  *pgxpool.Pool
	now   func() time.Time
	mu    sync.Mutex
	cache map[string]revocationEntry
}

func NewRevocations(pool *pgxpool.Pool) *Revocations {
	return &Revocations{TTL: revocationTTL, pool: pool, now: time.Now, cache: map[string]revocationEntry{}}
}

// Revoked reports whether this owner revoked this client, or every client. A lookup failure is
// returned as an error so the caller can fail closed rather than guess.
func (r *Revocations) Revoked(ctx context.Context, owner, client string) (bool, error) {
	key := owner + "\x00" + client
	r.mu.Lock()
	if hit, ok := r.cache[key]; ok && r.now().Sub(hit.at) < r.TTL {
		r.mu.Unlock()
		return hit.revoked, nil
	}
	r.mu.Unlock()
	revoked, err := grantRevoked(ctx, r.pool, owner, client)
	if err != nil {
		return false, err
	}
	r.mu.Lock()
	r.cache[key] = revocationEntry{revoked: revoked, at: r.now()}
	r.mu.Unlock()
	return revoked, nil
}

func grantRevoked(ctx context.Context, pool *pgxpool.Pool, owner, client string) (bool, error) {
	var revoked bool
	err := withReadTx(ctx, pool, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM revoked_grants WHERE owner_id=$1 AND client_id IN ($2,$3))`,
			owner, client, AnyClient).Scan(&revoked)
	})
	if err != nil {
		return false, err
	}
	return revoked, nil
}

// RevokeGrant permanently revokes one client's access to this account.
func RevokeGrant(ctx context.Context, pool *pgxpool.Pool, owner, client string) error {
	if owner == "" || !validClientID(client) {
		return errors.New("invalid client")
	}
	return inMeetingTx(ctx, pool, owner, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO revoked_grants(owner_id,client_id) VALUES($1,$2)
 ON CONFLICT (owner_id,client_id) DO NOTHING`, owner, client); err != nil {
			return errors.New("revocation unavailable")
		}
		var revoked bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM revoked_grants WHERE owner_id=$1 AND client_id=$2)`, owner, client).Scan(&revoked)
		if err != nil || !revoked {
			return errors.New("revocation unavailable")
		}
		return nil
	})
}

func validClientID(client string) bool {
	return client == AnyClient || (client != "" && len(client) <= 256 && strings.TrimSpace(client) == client)
}

type revokeInput struct {
	ClientID string `json:"client_id"`
}

// revokeHandler permanently revokes one client's access to the calling account.
func revokeHandler(pool *pgxpool.Pool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxRevokeBody+1))
		if err != nil || len(body) > MaxRevokeBody {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		client, err := parseRevokeInput(body)
		if err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		owner, _ := r.Context().Value(ownerKey{}).(string)
		if err := RevokeGrant(r.Context(), pool, owner, client); err != nil {
			http.Error(w, "revocation unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "revoked", "subject": owner, "client_id": client})
	})
}

func parseRevokeInput(body []byte) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var in revokeInput
	err := decoder.Decode(&in)
	if err == nil {
		err = decoder.Decode(&struct{}{})
	}
	if !errors.Is(err, io.EOF) || !validClientID(in.ClientID) {
		return "", errors.New("invalid request")
	}
	return in.ClientID, nil
}
