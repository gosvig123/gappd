package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const LiveActionsTimeout = 90 * time.Second

var ErrLiveActionsUnavailable = errors.New("draft action items require a recording meeting with no generation in progress")

const liveActionsSchema = `CREATE TABLE IF NOT EXISTS live_action_drafts (
 meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
 claim_token TEXT, claim_until TEXT, result_json TEXT
)`

func (d *DB) ClaimLiveActions(ctx context.Context, id string) (string, error) {
	token, err := newID()
	if err != nil {
		return "", err
	}
	now := time.Now()
	result, err := d.Conn.ExecContext(ctx, claimLiveActionsSQL, id, token,
		stamp(now.Add(LiveActionsTimeout+30*time.Second)), id, CaptureStatusRecording, stamp(now))
	ok, err := rowsChanged(result, err, "claim draft action items")
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrLiveActionsUnavailable
	}
	return token, nil
}

func (d *DB) ReleaseLiveActions(id, token string) error {
	_, err := d.Conn.Exec(`UPDATE live_action_drafts SET claim_token=NULL, claim_until=NULL WHERE meeting_id=? AND claim_token=?`, id, token)
	return err
}

func (d *DB) SaveLiveActions(ctx context.Context, id, token, resultJSON string) error {
	result, err := d.Conn.ExecContext(ctx, saveLiveActionsSQL, resultJSON, id, token, stamp(time.Now()), id, CaptureStatusRecording)
	ok, err := rowsChanged(result, err, "save draft action items")
	if err != nil {
		return err
	}
	if !ok {
		return ErrLiveActionsUnavailable
	}
	return nil
}

func (d *DB) LiveActions(ctx context.Context, id string) (*string, error) {
	var result *string
	err := d.Conn.QueryRowContext(ctx, `SELECT result_json FROM live_action_drafts WHERE meeting_id=?`, id).Scan(&result)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return result, err
}

const claimLiveActionsSQL = `INSERT INTO live_action_drafts(meeting_id, claim_token, claim_until)
 SELECT ?, ?, ? WHERE EXISTS(SELECT 1 FROM meetings WHERE id=? AND capture_status=?)
 ON CONFLICT(meeting_id) DO UPDATE SET claim_token=excluded.claim_token, claim_until=excluded.claim_until
 WHERE live_action_drafts.claim_token IS NULL OR live_action_drafts.claim_until < ?`

const saveLiveActionsSQL = `UPDATE live_action_drafts SET result_json=?
 WHERE meeting_id=? AND claim_token=? AND claim_until>?
 AND EXISTS(SELECT 1 FROM meetings WHERE id=? AND capture_status=?)`
