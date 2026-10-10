-- Migration 006: per-account grant revocation.
-- A revocation is permanent: there is no un-revoke path, and a row is never deleted.
-- client_id '*' revokes every client for that account, including a token with no client claim.

CREATE TABLE revoked_grants (
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 256),
 revoked_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY (owner_id, client_id)
);
ALTER TABLE revoked_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON revoked_grants FROM PUBLIC;

CREATE POLICY revoked_grants_owner ON revoked_grants FOR SELECT
 USING (current_user IN ('gappd_reader','gappd_meeting_writer') AND owner_id=current_setting('app.owner_id',true));
CREATE POLICY revoked_grants_insert ON revoked_grants FOR INSERT
 WITH CHECK (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));

-- Existing deployments already hold these roles. Fresh databases grant in Provision.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_reader') THEN
  GRANT SELECT ON revoked_grants TO gappd_reader;
 END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_meeting_writer') THEN
  GRANT SELECT, INSERT ON revoked_grants TO gappd_meeting_writer;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (6);
