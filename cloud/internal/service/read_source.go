package service

// Owner-scoped reads of cloud Meeting copies. Each query also filters by owner, and the reader's
// row level security on cloud_meetings hides other owners, deleted copies and expired copies.
const (
	readMeetingSQL = `SELECT id::text,title,summary,transcript,started_at,updated_at FROM cloud_meetings
 WHERE id=$1 AND owner_id=$2`
	listMeetingsSQL = `SELECT id::text,title,started_at,updated_at FROM cloud_meetings
 WHERE owner_id=$1
 AND ($2::timestamptz IS NULL OR started_at>=$2) AND ($3::timestamptz IS NULL OR started_at<$3)
 ORDER BY started_at DESC,id DESC OFFSET $4 LIMIT $5`
	searchMeetingsSQL = `SELECT id::text,title,started_at,ts_headline('english',
 CASE WHEN to_tsvector('english',transcript)@@q THEN transcript ELSE title||E'\n'||summary END,
 q,'MaxWords=30,MinWords=8,MaxFragments=1') FROM cloud_meetings,websearch_to_tsquery('english',$2) q
 WHERE owner_id=$1 AND to_tsvector('english',title||' '||summary||' '||transcript)@@q
 ORDER BY ts_rank(to_tsvector('english',title||' '||summary||' '||transcript),q) DESC,started_at DESC LIMIT $3`
)
