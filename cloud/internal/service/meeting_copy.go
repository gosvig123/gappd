package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MeetingCopyID maps one local Meeting to its cloud copy. The namespace is separate from
// every synthetic namespace, so a real copy can never collide with a demo identity.
func MeetingCopyID(owner, localID string) string {
	sum := sha256.Sum256([]byte("gappd-meeting-v1:" + owner + ":" + localID))
	sum[6] = (sum[6] & 15) | 128
	sum[8] = (sum[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

func OpenMeetingPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid meeting database configuration")
	}
	config.MaxConns = 2
	config.ConnConfig.RuntimeParams["statement_timeout"] = "3000"
	config.ConnConfig.RuntimeParams["lock_timeout"] = "2000"
	config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "5000"
	config.AfterConnect = verifyMeetingRole
	return pgxpool.NewWithConfig(ctx, config)
}

func verifyMeetingRole(ctx context.Context, conn *pgx.Conn) error {
	var safe bool
	err := conn.QueryRow(ctx, `SELECT current_user='gappd_meeting_writer' AND NOT rolsuper AND NOT rolbypassrls
 AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member=pg_roles.oid)
 AND NOT EXISTS (SELECT FROM pg_class WHERE relname IN ('meetings','meeting_lifecycle') AND relowner=pg_roles.oid)
 FROM pg_roles WHERE rolname=current_user`).Scan(&safe)
	if err != nil || !safe {
		return errors.New("runtime requires isolated gappd_meeting_writer role")
	}
	return nil
}
