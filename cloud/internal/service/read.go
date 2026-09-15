package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxPageSize = 50
const maxMatches = 25

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
	if !p.valid() {
		return result, errors.New("invalid page")
	}
	// ponytail: offset paging over one owner's rows; add keyset paging if a page set grows past 1000.
	err := withReadTx(ctx, pool, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, queries().list,
			owner, optionalTime(p.Since), optionalTime(p.Until), p.Offset, p.Limit+1)
		if err != nil {
			return errors.New("Meetings unavailable")
		}
		defer rows.Close()
		if result.Meetings, err = scanSummaries(rows); err != nil {
			return err
		}
		if len(result.Meetings) > p.Limit {
			result.Meetings, result.NextOffset = result.Meetings[:p.Limit], p.Offset+p.Limit
		}
		return nil
	})
	return result, err
}

func (p ListParams) valid() bool {
	if p.Limit < 1 || p.Limit > maxPageSize || p.Offset < 0 || p.Offset > maxPageSize*20 {
		return false
	}
	return p.Until.IsZero() || p.Since.IsZero() || !p.Until.Before(p.Since)
}

func scanSummaries(rows pgx.Rows) ([]MeetingSummary, error) {
	items := []MeetingSummary{}
	for rows.Next() {
		var s MeetingSummary
		if err := rows.Scan(&s.ID, &s.Title, &s.StartedAt, &s.UpdatedAt); err != nil {
			return nil, errors.New("Meetings unavailable")
		}
		items = append(items, s)
	}
	if rows.Err() != nil {
		return nil, errors.New("Meetings unavailable")
	}
	return items, nil
}

func optionalTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

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
		rows, err := tx.Query(ctx, queries().search, owner, query, limit)
		if err != nil {
			return errors.New("Meetings unavailable")
		}
		defer rows.Close()
		result.Matches, err = scanHits(rows)
		return err
	})
	return result, err
}

func scanHits(rows pgx.Rows) ([]SearchHit, error) {
	items := []SearchHit{}
	for rows.Next() {
		var h SearchHit
		if err := rows.Scan(&h.ID, &h.Title, &h.StartedAt, &h.Passage); err != nil {
			return nil, errors.New("Meetings unavailable")
		}
		h.Passage = plainPassage(h.Passage)
		items = append(items, h)
	}
	if rows.Err() != nil {
		return nil, errors.New("Meetings unavailable")
	}
	return items, nil
}

// plainPassage drops the ts_headline match markers from returned text.
func plainPassage(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(text, "<b>", ""), "</b>", "")
}
