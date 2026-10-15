-- Migration 007: account generation and upload gate.
-- A delete-all bumps the generation and blocks uploads, so a device that still holds an old
-- authorization cannot restore erased data. Only an explicit consent opens uploads again, and it
-- issues a new generation that a stale device does not know.

CREATE TABLE account_state (
 owner_id text PRIMARY KEY CHECK (length(owner_id) BETWEEN 1 AND 256),
 generation integer NOT NULL DEFAULT 1 CHECK (generation>=1),
 uploads_allowed boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE account_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON account_state FROM PUBLIC;

CREATE POLICY account_state_writer ON account_state
 USING (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true))
 WITH CHECK (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));

-- Existing deployments already hold the writer role. Fresh databases grant in provision-meeting.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_meeting_writer') THEN
  GRANT SELECT, INSERT, UPDATE ON account_state TO gappd_meeting_writer;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (7);
