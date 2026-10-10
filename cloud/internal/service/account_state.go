package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errUploadsBlocked = errors.New("uploads blocked")
var errGenerationMismatch = errors.New("stale generation")

// DeleteAccountCopies removes every cloud copy of one account in one transaction: it marks each
// identity deleted, deletes the content, and blocks uploads under a new generation. A device that
// still holds the old generation cannot restore what was erased.
func DeleteAccountCopies(ctx context.Context, pool *pgxpool.Pool, owner string) (int, error) {
	if owner == "" {
		return 0, errors.New("invalid account")
	}
	var removed int
	err := inMeetingTx(ctx, pool, owner, func(tx pgx.Tx) error {
		if err := lockOwner(ctx, tx, owner); err != nil {
			return err
		}
		if err := blockUploads(ctx, tx, owner); err != nil {
			return err
		}
		count, err := eraseCopies(ctx, tx, owner)
		if err != nil {
			return err
		}
		removed = count
		return verifyAccountEmpty(ctx, tx, owner)
	})
	if err != nil {
		return 0, err
	}
	return removed, nil
}

// blockUploads bumps the generation and closes uploads under the account lock.
func blockUploads(ctx context.Context, tx pgx.Tx, owner string) error {
	_, err := tx.Exec(ctx, `INSERT INTO account_state(owner_id,generation,uploads_allowed) VALUES($1,1,false)
 ON CONFLICT (owner_id) DO UPDATE SET generation=account_state.generation+1,uploads_allowed=false,
 updated_at=statement_timestamp()`, owner)
	if err != nil {
		return errors.New("account deletion unavailable")
	}
	return nil
}

// eraseCopies marks every live identity, then removes the content.
func eraseCopies(ctx context.Context, tx pgx.Tx, owner string) (int, error) {
	_, err := tx.Exec(ctx, `UPDATE meeting_lifecycle SET deleted_at=coalesce(deleted_at,statement_timestamp())
 WHERE owner_id=$1 AND deleted_at IS NULL`, owner)
	if err != nil {
		return 0, errors.New("account deletion unavailable")
	}
	tag, err := tx.Exec(ctx, `DELETE FROM cloud_meetings WHERE owner_id=$1`, owner)
	if err != nil {
		return 0, errors.New("account deletion unavailable")
	}
	return int(tag.RowsAffected()), nil
}

func verifyAccountEmpty(ctx context.Context, tx pgx.Tx, owner string) error {
	var allowed bool
	var remaining, unmarked int
	err := tx.QueryRow(ctx, `SELECT
 (SELECT uploads_allowed FROM account_state WHERE owner_id=$1),
 (SELECT count(*) FROM cloud_meetings WHERE owner_id=$1),
 (SELECT count(*) FROM meeting_lifecycle WHERE owner_id=$1 AND deleted_at IS NULL)`, owner).Scan(&allowed, &remaining, &unmarked)
	if err != nil || allowed || remaining != 0 || unmarked != 0 {
		return errors.New("account deletion unavailable")
	}
	return nil
}

// ConsentUploads opens uploads again and issues a new generation, which only the caller learns.
func ConsentUploads(ctx context.Context, pool *pgxpool.Pool, owner string) (int, error) {
	if owner == "" {
		return 0, errors.New("invalid account")
	}
	generation := 0
	err := inMeetingTx(ctx, pool, owner, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `INSERT INTO account_state(owner_id,generation,uploads_allowed) VALUES($1,1,true)
 ON CONFLICT (owner_id) DO UPDATE SET uploads_allowed=true,generation=account_state.generation+1,
 updated_at=statement_timestamp() RETURNING generation`, owner).Scan(&generation)
		if err != nil {
			return errors.New("consent unavailable")
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return generation, nil
}

// checkAccountUploads refuses a write while uploads are blocked, and refuses one that does not
// present the account's current generation. An account with no state row has nothing to match.
func checkAccountUploads(ctx context.Context, tx pgx.Tx, owner string, generation int) error {
	var stored int
	var allowed bool
	err := tx.QueryRow(ctx, `SELECT generation,uploads_allowed FROM account_state WHERE owner_id=$1 FOR UPDATE`, owner).Scan(&stored, &allowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return errors.New("cloud copy unavailable")
	}
	if !allowed {
		return errUploadsBlocked
	}
	if stored != generation {
		return errGenerationMismatch
	}
	return nil
}
