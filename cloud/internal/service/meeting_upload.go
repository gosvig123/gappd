package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UploadMeeting stores one validated document as this account's cloud copy. A retry never
// extends the fixed expiry, an older revision never replaces a newer one, and a copy that is
// deleted or expired is never written again.
func UploadMeeting(ctx context.Context, pool *pgxpool.Pool, owner string, generation int, data []byte) (string, error) {
	document, err := ParseMeetingDocument(data)
	if err != nil || owner == "" {
		return "", errDocument
	}
	id := MeetingCopyID(owner, document.MeetingID)
	err = inMeetingTx(ctx, pool, owner, func(tx pgx.Tx) error {
		return storeCopy(ctx, tx, owner, id, document, data, generation)
	})
	if err != nil {
		return "", err
	}
	return id, nil
}

func storeCopy(ctx context.Context, tx pgx.Tx, owner, id string, document MeetingDocument, data []byte, generation int) error {
	if err := lockOwner(ctx, tx, owner); err != nil {
		return err
	}
	// The account gate is read under the same lock as the write, so a delete-all cannot race it.
	if err := checkAccountUploads(ctx, tx, owner, generation); err != nil {
		return err
	}
	// An existing acceptance is left alone, so a retry cannot move the fixed expiry.
	if _, err := tx.Exec(ctx, `INSERT INTO meeting_lifecycle(id,owner_id,local_id,accepted_at,expires_at)
 VALUES($1,$2,$3,statement_timestamp(),statement_timestamp()+interval '720 hours') ON CONFLICT DO NOTHING`,
		id, owner, document.MeetingID); err != nil {
		return errors.New("cloud copy unavailable")
	}
	if err := checkCapacity(ctx, tx, owner, id, len(data)); err != nil {
		return err
	}
	if err := writeCopy(ctx, tx, owner, id, document, data); err != nil {
		return err
	}
	return verifyStored(ctx, tx, owner, id, document, data)
}

// writeCopy replaces the whole copy. An equal or older revision changes no row.
func writeCopy(ctx context.Context, tx pgx.Tx, owner, id string, document MeetingDocument, data []byte) error {
	_, err := tx.Exec(ctx, `INSERT INTO cloud_meetings
 (id,owner_id,title,summary,transcript,started_at,updated_at,revision,document)
 VALUES ($1,$2,$3,$4,$5,$6::timestamptz,statement_timestamp(),$7,$8::jsonb)
 ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,transcript=EXCLUDED.transcript,
 started_at=EXCLUDED.started_at,updated_at=EXCLUDED.updated_at,revision=EXCLUDED.revision,document=EXCLUDED.document
 WHERE cloud_meetings.revision<EXCLUDED.revision`,
		id, owner, document.Title, document.Summary, document.Transcript(), document.StartedAt, document.Revision, string(data))
	if err != nil {
		return errors.New("cloud copy unavailable")
	}
	return nil
}

// verifyStored confirms the copy is live and that a repeated revision carried the same bytes.
func verifyStored(ctx context.Context, tx pgx.Tx, owner, id string, document MeetingDocument, data []byte) error {
	var revision int
	var live, same bool
	err := tx.QueryRow(ctx, `SELECT revision,
 EXISTS (SELECT FROM meeting_lifecycle l WHERE l.id=cloud_meetings.id AND l.owner_id=cloud_meetings.owner_id
  AND l.deleted_at IS NULL AND l.expires_at>clock_timestamp()),
 title=$3 AND summary=$4 AND document=$5::jsonb
 FROM cloud_meetings WHERE id=$1 AND owner_id=$2`,
		id, owner, document.Title, document.Summary, string(data)).Scan(&revision, &live, &same)
	if err != nil || !live {
		return errors.New("cloud copy unavailable")
	}
	if revision == document.Revision && !same {
		return errors.New("revision conflict")
	}
	return nil
}

// DeleteMeeting removes one owned cloud copy and keeps a permanent deletion marker.
func DeleteMeeting(ctx context.Context, pool *pgxpool.Pool, owner, localID string) error {
	if owner == "" || !meetingID.MatchString(localID) {
		return errors.New("invalid Meeting")
	}
	id := MeetingCopyID(owner, localID)
	return inMeetingTx(ctx, pool, owner, func(tx pgx.Tx) error {
		if err := lockOwner(ctx, tx, owner); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO meeting_lifecycle(id,owner_id,local_id,deleted_at)
 VALUES($1,$2,$3,statement_timestamp())
 ON CONFLICT (owner_id,id) DO UPDATE SET deleted_at=coalesce(meeting_lifecycle.deleted_at,excluded.deleted_at)`,
			id, owner, localID); err != nil {
			return errors.New("cloud copy unavailable")
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cloud_meetings WHERE id=$1 AND owner_id=$2`, id, owner); err != nil {
			return errors.New("cloud copy unavailable")
		}
		return verifyDeleted(ctx, tx, owner, id)
	})
}

func verifyDeleted(ctx context.Context, tx pgx.Tx, owner, id string) error {
	var removed bool
	err := tx.QueryRow(ctx, `SELECT deleted_at IS NOT NULL
 AND NOT EXISTS (SELECT FROM cloud_meetings m WHERE m.id=$2 AND m.owner_id=$1)
 FROM meeting_lifecycle WHERE owner_id=$1 AND id=$2`, owner, id).Scan(&removed)
	if err != nil || !removed {
		return errors.New("cloud copy unavailable")
	}
	return nil
}

func lockOwner(ctx context.Context, tx pgx.Tx, owner string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,74812003))`, owner); err != nil {
		return errors.New("cloud copy unavailable")
	}
	return nil
}

func inMeetingTx(ctx context.Context, pool *pgxpool.Pool, owner string, fn func(pgx.Tx) error) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return errors.New("cloud copy unavailable")
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id',$1,true)`, owner); err != nil {
		return errors.New("cloud copy unavailable")
	}
	if err = fn(tx); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return errors.New("cloud copy unavailable")
	}
	return nil
}
