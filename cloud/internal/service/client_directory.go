package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// recordTimeout bounds the background write that keeps the client list current.
const recordTimeout = 2 * time.Second

// AccountClient is one client that has used an account. No lifecycle metadata is exposed.
type AccountClient struct {
	ClientID    string    `json:"client_id"`
	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

// ClientDirectory keeps the list of clients that have used each account, so a revocation can
// offer a choice instead of asking for an id.
//
// A pair is written once per process, in the background, so the hot path pays one small insert
// rather than one per request. The write uses the writer pool: the reader pool is deliberately
// unable to write anything.
type ClientDirectory struct {
	pool     *pgxpool.Pool
	mu       sync.Mutex
	inflight map[string]bool
}

func NewClientDirectory(pool *pgxpool.Pool) *ClientDirectory {
	return &ClientDirectory{pool: pool, inflight: map[string]bool{}}
}

// Record notes that this client used this account. It never blocks the request and never reports
// a failure: a missed entry only means the id has to be typed instead of picked.
func (d *ClientDirectory) Record(owner, client string) {
	if d == nil || d.pool == nil || owner == "" || !validClientID(client) || client == AnyClient {
		return
	}
	key := owner + "\x00" + client
	d.mu.Lock()
	if d.inflight[key] {
		d.mu.Unlock()
		return
	}
	d.inflight[key] = true
	d.mu.Unlock()
	go d.write(owner, client, key)
}

func (d *ClientDirectory) write(owner, client, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), recordTimeout)
	defer cancel()
	err := inMeetingTx(ctx, d.pool, owner, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO account_clients(owner_id,client_id) VALUES($1,$2)
 ON CONFLICT (owner_id,client_id) DO UPDATE SET last_seen_at=statement_timestamp()`, owner, client)
		return err
	})
	if err != nil {
		// Let a later request try again rather than losing the client for this process.
		d.mu.Lock()
		delete(d.inflight, key)
		d.mu.Unlock()
	}
}

// Clients returns the clients seen for one account, most recently used first.
func (d *ClientDirectory) Clients(ctx context.Context, owner string) ([]AccountClient, error) {
	clients := []AccountClient{}
	err := withReadTx(ctx, d.pool, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT client_id,first_seen_at,last_seen_at FROM account_clients
 WHERE owner_id=$1 ORDER BY last_seen_at DESC,client_id LIMIT 50`, owner)
		if err != nil {
			return errors.New("clients unavailable")
		}
		defer rows.Close()
		for rows.Next() {
			var client AccountClient
			if err = rows.Scan(&client.ClientID, &client.FirstSeenAt, &client.LastSeenAt); err != nil {
				return errors.New("clients unavailable")
			}
			clients = append(clients, client)
		}
		if rows.Err() != nil {
			return errors.New("clients unavailable")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return clients, nil
}
