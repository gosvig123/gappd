package admin

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ProvisionMeeting is an explicit private administrator action, never runtime setup.
// It stays separate from the synthetic writer so neither role can reach the other's table.
func ProvisionMeeting(ctx context.Context, conn *pgx.Conn, password string) error {
	if len(password) < 24 || strings.ContainsAny(password, "\x00\r\n") {
		return errors.New("invalid password")
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = mutationRole(ctx, tx, "gappd_meeting_writer", password); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, meetingPolicy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// meetingPolicy constrains the real-copy writer to its own owner-scoped rows.
const meetingPolicy = `
 GRANT USAGE ON SCHEMA public TO gappd_meeting_writer;
 GRANT SELECT, INSERT, UPDATE, DELETE ON cloud_meetings TO gappd_meeting_writer;
 GRANT SELECT, INSERT ON meeting_lifecycle TO gappd_meeting_writer;
 GRANT SELECT, INSERT ON revoked_grants TO gappd_meeting_writer;
 GRANT SELECT, INSERT, UPDATE ON account_state TO gappd_meeting_writer;
 GRANT UPDATE(deleted_at) ON meeting_lifecycle TO gappd_meeting_writer;
 ALTER ROLE gappd_meeting_writer SET statement_timeout='3s';
 DROP POLICY IF EXISTS cloud_meeting_writer_read ON cloud_meetings;
 CREATE POLICY cloud_meeting_writer_read ON cloud_meetings FOR SELECT
 USING (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));
 DROP POLICY IF EXISTS cloud_meeting_writer_insert ON cloud_meetings;
 CREATE POLICY cloud_meeting_writer_insert ON cloud_meetings FOR INSERT
 WITH CHECK (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));
 DROP POLICY IF EXISTS cloud_meeting_writer_update ON cloud_meetings;
 CREATE POLICY cloud_meeting_writer_update ON cloud_meetings FOR UPDATE
 USING (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true))
 WITH CHECK (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));
 DROP POLICY IF EXISTS cloud_meeting_writer_delete ON cloud_meetings;
 CREATE POLICY cloud_meeting_writer_delete ON cloud_meetings FOR DELETE
 USING (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true)
 AND EXISTS (SELECT FROM meeting_lifecycle l WHERE l.id=cloud_meetings.id AND l.owner_id=cloud_meetings.owner_id
 AND l.deleted_at IS NOT NULL));
 DROP POLICY IF EXISTS meeting_lifecycle_writer ON meeting_lifecycle;
 CREATE POLICY meeting_lifecycle_writer ON meeting_lifecycle
 USING (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true))
 WITH CHECK (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));
`
