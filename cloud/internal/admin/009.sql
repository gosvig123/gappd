-- Migration 009: the clients that have used an account.
-- A revocation is keyed on a client id, and the user should be able to pick one instead of
-- typing it, so the service keeps the list of clients it has seen for each account.

CREATE TABLE account_clients (
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 256),
 first_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 last_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY (owner_id, client_id)
);
ALTER TABLE account_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_clients FORCE ROW LEVEL SECURITY;
REVOKE ALL ON account_clients FROM PUBLIC;

CREATE POLICY account_clients_writer ON account_clients
 USING (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true))
 WITH CHECK (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));

-- Existing deployments already hold the writer role. Fresh databases grant in provision-meeting.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_meeting_writer') THEN
  GRANT SELECT, INSERT, UPDATE ON account_clients TO gappd_meeting_writer;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (9);
