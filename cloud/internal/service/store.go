package service

import (
	"context"
	"errors"
	"regexp"
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
	if owner == "" {
		return m, unavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return m, errors.New("Meeting unavailable")
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `SELECT set_config('app.owner_id', $1, true)`, owner); err != nil {
		return m, errors.New("Meeting unavailable")
	}
	return readMeeting(ctx, tx, owner, id)
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
 AND NOT EXISTS (SELECT FROM pg_class WHERE relname='meetings' AND relowner=pg_roles.oid)
 FROM pg_roles WHERE rolname=current_user`).Scan(&safe)
	if err != nil || !safe {
		return errors.New("runtime requires isolated gappd_reader role")
	}
	return nil
}
