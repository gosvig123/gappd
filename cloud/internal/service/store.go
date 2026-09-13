package service

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const DemoID = "b47c5e70-8030-4b9e-bb5a-146d17c68731"

var meetingID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var unavailable = errors.New("Meeting not found")

type Meeting struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Summary    string    `json:"summary"`
	Transcript string    `json:"transcript"`
	StartedAt  time.Time `json:"started_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	Synthetic  bool      `json:"synthetic"`
}

func Read(ctx context.Context, pool *pgxpool.Pool, owner, id string) (Meeting, error) {
	var m Meeting
	if !meetingID.MatchString(id) {
		return m, errors.New("invalid Meeting ID")
	}
	err := withReadTx(ctx, pool, owner, func(ctx context.Context, tx pgx.Tx) error {
		var readErr error
		m, readErr = readMeeting(ctx, tx, owner, id)
		return readErr
	})
	return m, err
}

// withReadTx gives every owner-scoped read the same bounded, read-only transaction.
func withReadTx(ctx context.Context, pool *pgxpool.Pool, owner string, fn func(context.Context, pgx.Tx) error) error {
	if owner == "" {
		return unavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return errors.New("Meetings unavailable")
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id', $1, true)`, owner); err != nil {
		return errors.New("Meetings unavailable")
	}
	return fn(ctx, tx)
}

const maxPageSize = 50

type MeetingSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	StartedAt time.Time `json:"started_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ListParams struct {
	Since  time.Time
	Until  time.Time
	Offset int
	Limit  int
}

type ListResult struct {
	Meetings   []MeetingSummary `json:"meetings"`
	NextOffset int              `json:"next_offset,omitempty"`
}

// List returns owned Meetings newest first. It never exposes transcript text.
func List(ctx context.Context, pool *pgxpool.Pool, owner string, p ListParams) (ListResult, error) {
	result := ListResult{Meetings: []MeetingSummary{}}
	if p.Limit < 1 || p.Limit > maxPageSize || p.Offset < 0 || p.Offset > maxPageSize*20 || !p.Until.IsZero() && p.Until.Before(p.Since) {
		return result, errors.New("invalid page")
	}
	// ponytail: offset paging over one owner's rows; add keyset paging if a page set grows past 1000.
	err := withReadTx(ctx, pool, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id::text,title,started_at,updated_at FROM meetings
 WHERE owner_id=$1 AND synthetic=true
 AND ($2::timestamptz IS NULL OR started_at>=$2) AND ($3::timestamptz IS NULL OR started_at<$3)
 ORDER BY started_at DESC,id DESC OFFSET $4 LIMIT $5`,
			owner, optionalTime(p.Since), optionalTime(p.Until), p.Offset, p.Limit+1)
		if err != nil {
			return errors.New("Meetings unavailable")
		}
		defer rows.Close()
		for rows.Next() {
			var s MeetingSummary
			if err = rows.Scan(&s.ID, &s.Title, &s.StartedAt, &s.UpdatedAt); err != nil {
				return errors.New("Meetings unavailable")
			}
			result.Meetings = append(result.Meetings, s)
		}
		if rows.Err() != nil {
			return errors.New("Meetings unavailable")
		}
		if len(result.Meetings) > p.Limit {
			result.Meetings = result.Meetings[:p.Limit]
			result.NextOffset = p.Offset + p.Limit
		}
		return nil
	})
	return result, err
}

func optionalTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

const maxMatches = 25

type SearchHit struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	StartedAt time.Time `json:"started_at"`
	Passage   string    `json:"passage"`
}

type SearchResult struct {
	Matches []SearchHit `json:"matches"`
}

// Search returns ranked matching passages. Transcript text is untrusted source data.
func Search(ctx context.Context, pool *pgxpool.Pool, owner, query string, limit int) (SearchResult, error) {
	result := SearchResult{Matches: []SearchHit{}}
	if strings.TrimSpace(query) == "" || len(query) > 200 || limit < 1 || limit > maxMatches {
		return result, errors.New("invalid search")
	}
	// ponytail: one on-the-fly tsvector scan, bounded by owner; add a stored tsvector column if search volume grows.
	err := withReadTx(ctx, pool, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id::text,title,started_at,ts_headline('english',
 CASE WHEN to_tsvector('english',transcript)@@q THEN transcript ELSE title||E'\n'||summary END,
 q,'MaxWords=30,MinWords=8,MaxFragments=1') FROM meetings,plainto_tsquery('english',$2) q
 WHERE owner_id=$1 AND synthetic=true AND to_tsvector('english',title||' '||summary||' '||transcript)@@q
 ORDER BY ts_rank(to_tsvector('english',title||' '||summary||' '||transcript),q) DESC,started_at DESC LIMIT $3`,
			owner, query, limit)
		if err != nil {
			return errors.New("Meetings unavailable")
		}
		defer rows.Close()
		for rows.Next() {
			var h SearchHit
			if err = rows.Scan(&h.ID, &h.Title, &h.StartedAt, &h.Passage); err != nil {
				return errors.New("Meetings unavailable")
			}
			result.Matches = append(result.Matches, h)
		}
		if rows.Err() != nil {
			return errors.New("Meetings unavailable")
		}
		return nil
	})
	return result, err
}

func readMeeting(ctx context.Context, tx pgx.Tx, owner, id string) (Meeting, error) {
	var m Meeting
	err := tx.QueryRow(ctx, `SELECT id::text,title,summary,transcript,started_at,updated_at,synthetic
 FROM meetings WHERE id=$1 AND owner_id=$2 AND synthetic=true`, id, owner).Scan(
		&m.ID, &m.Title, &m.Summary, &m.Transcript, &m.StartedAt, &m.UpdatedAt, &m.Synthetic)
	if errors.Is(err, pgx.ErrNoRows) {
		return Meeting{}, unavailable
	}
	if err != nil {
		return Meeting{}, errors.New("Meeting unavailable")
	}
	return m, nil
}

func OpenPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	c, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid database configuration")
	}
	c.MaxConns = 4
	c.AfterConnect = verifyRuntimeRole
	c.ConnConfig.RuntimeParams["statement_timeout"] = "3000"
	c.ConnConfig.RuntimeParams["lock_timeout"] = "2000"
	c.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "5000"
	return pgxpool.NewWithConfig(ctx, c)
}

// Fail closed if a deployment accidentally supplies administrator credentials.
func verifyRuntimeRole(ctx context.Context, conn *pgx.Conn) error {
	var safe bool
	err := conn.QueryRow(ctx, `SELECT current_user='gappd_reader' AND NOT rolsuper AND NOT rolbypassrls
 AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member=pg_roles.oid)
 AND NOT EXISTS (SELECT FROM pg_class WHERE relname IN ('meetings','demo_lifecycle') AND relowner=pg_roles.oid)
 FROM pg_roles WHERE rolname=current_user`).Scan(&safe)
	if err != nil || !safe {
		return errors.New("runtime requires isolated gappd_reader role")
	}
	return nil
}
