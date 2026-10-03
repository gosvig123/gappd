-- Migration 008: registered upload devices.
-- A bearer token alone must not be enough to write. A device registers a public key, and every
-- write carries a signature over the method, path, device, generation and body digest.

CREATE TABLE account_devices (
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 device_id text NOT NULL CHECK (device_id ~ '^[0-9a-f]{64}$'),
 public_key bytea NOT NULL CHECK (octet_length(public_key)=32),
 registered_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 revoked_at timestamptz,
 PRIMARY KEY (owner_id, device_id)
);
ALTER TABLE account_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_devices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON account_devices FROM PUBLIC;

CREATE POLICY account_devices_writer ON account_devices
 USING (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true))
 WITH CHECK (current_user='gappd_meeting_writer' AND owner_id=current_setting('app.owner_id',true));

-- Existing deployments already hold the writer role. Fresh databases grant in provision-meeting.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_meeting_writer') THEN
  GRANT SELECT, INSERT, UPDATE ON account_devices TO gappd_meeting_writer;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (8);
