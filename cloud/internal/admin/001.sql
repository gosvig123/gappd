CREATE TABLE IF NOT EXISTS cloud_migrations (version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS meetings (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 title text NOT NULL CHECK (octet_length(title)<=512),
 summary text NOT NULL CHECK (octet_length(summary)<=4096),
 transcript text NOT NULL CHECK (octet_length(transcript)<=16384),
 started_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 synthetic boolean NOT NULL CHECK (synthetic=true)
);
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meeting_owner ON meetings;
CREATE POLICY meeting_owner ON meetings FOR SELECT
 USING (owner_id = current_setting('app.owner_id', true));
REVOKE ALL ON meetings FROM PUBLIC;
INSERT INTO cloud_migrations VALUES (1) ON CONFLICT DO NOTHING;
