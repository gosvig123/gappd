package admin

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// ProvisionMeetingCleanup is an explicit private administrator action, never runtime setup.
// It stays separate from the synthetic cleanup role, so neither can reach the other's rows.
func ProvisionMeetingCleanup(ctx context.Context, conn *pgx.Conn, password string) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = mutationRole(ctx, tx, "gappd_meeting_cleanup", password); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, meetingCleanupPolicy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// meetingCleanupPolicy lets the role mark and remove expired real copies only. The lifecycle
// trigger still forbids clearing a marker or moving an acceptance or expiry.
const meetingCleanupPolicy = `
 GRANT USAGE ON SCHEMA public TO gappd_meeting_cleanup;
 GRANT SELECT ON meeting_lifecycle TO gappd_meeting_cleanup;
 GRANT UPDATE(deleted_at) ON meeting_lifecycle TO gappd_meeting_cleanup;
 GRANT SELECT, DELETE ON cloud_meetings TO gappd_meeting_cleanup;
 ALTER ROLE gappd_meeting_cleanup SET statement_timeout='3s';
 DROP POLICY IF EXISTS cloud_meeting_cleanup_read ON cloud_meetings;
 CREATE POLICY cloud_meeting_cleanup_read ON cloud_meetings FOR SELECT TO gappd_meeting_cleanup
 USING (current_user='gappd_meeting_cleanup' AND EXISTS (SELECT FROM meeting_lifecycle l
 WHERE l.id=cloud_meetings.id AND l.owner_id=cloud_meetings.owner_id AND l.expires_at<=statement_timestamp()));
 DROP POLICY IF EXISTS cloud_meeting_cleanup_delete ON cloud_meetings;
 CREATE POLICY cloud_meeting_cleanup_delete ON cloud_meetings FOR DELETE TO gappd_meeting_cleanup
 USING (current_user='gappd_meeting_cleanup' AND EXISTS (SELECT FROM meeting_lifecycle l
 WHERE l.id=cloud_meetings.id AND l.owner_id=cloud_meetings.owner_id
 AND l.expires_at<=statement_timestamp() AND l.deleted_at IS NOT NULL));
 DROP POLICY IF EXISTS meeting_lifecycle_cleanup ON meeting_lifecycle;
 CREATE POLICY meeting_lifecycle_cleanup ON meeting_lifecycle TO gappd_meeting_cleanup
 USING (current_user='gappd_meeting_cleanup' AND expires_at<=statement_timestamp())
 WITH CHECK (current_user='gappd_meeting_cleanup' AND expires_at<=statement_timestamp());
`
