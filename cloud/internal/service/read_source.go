package service

import (
	"context"
	"errors"
	"sync/atomic"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The synthetic surface keeps the demo slice exactly as it was: synthetic rows only.
const syntheticSource = `(SELECT id,owner_id,title,summary,transcript,started_at,updated_at,synthetic
 FROM meetings WHERE synthetic=true)`

// The union view migration 005 creates. It is read with security_invoker, so the base
// tables keep enforcing their own row level security for the reader.
const realSource = `cloud_read_meetings`

type readQueries struct {
	meeting string
	list    string
	search  string
}

var realCopies atomic.Bool

// SetRealCopies switches the process between the synthetic-only surface and the union of
// synthetic rows and owned cloud copies. It fails closed when the view is absent, so a
// deployment cannot enable real reads before migration 005 is applied.
func SetRealCopies(ctx context.Context, pool *pgxpool.Pool, enabled bool) error {
	if !enabled {
		realCopies.Store(false)
		return nil
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.cloud_read_meetings') IS NOT NULL`).Scan(&exists); err != nil || !exists {
		return errors.New("real copies require migration 005")
	}
	realCopies.Store(true)
	return nil
}

func queries() readQueries {
	if realCopies.Load() {
		return realReadQueries
	}
	return syntheticReadQueries
}

// buildQueries keeps one query body per operation and varies only the read surface.
func buildQueries(source string) readQueries {
	return readQueries{
		meeting: `SELECT id::text,title,summary,transcript,started_at,updated_at,synthetic FROM ` +
			source + ` WHERE id=$1 AND owner_id=$2`,
		list: `SELECT id::text,title,started_at,updated_at FROM ` + source + `
 WHERE owner_id=$1
 AND ($2::timestamptz IS NULL OR started_at>=$2) AND ($3::timestamptz IS NULL OR started_at<$3)
 ORDER BY started_at DESC,id DESC OFFSET $4 LIMIT $5`,
		search: `SELECT id::text,title,started_at,ts_headline('english',
 CASE WHEN to_tsvector('english',transcript)@@q THEN transcript ELSE title||E'\n'||summary END,
 q,'MaxWords=30,MinWords=8,MaxFragments=1') FROM ` + source + `,plainto_tsquery('english',$2) q
 WHERE owner_id=$1 AND to_tsvector('english',title||' '||summary||' '||transcript)@@q
 ORDER BY ts_rank(to_tsvector('english',title||' '||summary||' '||transcript),q) DESC,started_at DESC LIMIT $3`,
	}
}

var syntheticReadQueries = buildQueries(syntheticSource)
var realReadQueries = buildQueries(realSource)
