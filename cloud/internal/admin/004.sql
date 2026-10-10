-- Migration 004: general cloud Meeting copies.
-- Purely additive. The synthetic `meetings` table keeps its constraint, policies and
-- control records exactly as they are, so the synthetic slice's blast radius does not
-- change. A real copy lives in its own table and never shares a policy with a demo row.

CREATE FUNCTION meeting_copy_id(owner text, local_id text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (substr(h,1,12)||'8'||substr(h,14,3)||
 substr('89ab', ((get_byte(decode(h,'hex'),8) >> 4) & 3)+1,1)||substr(h,18,15))::uuid
 FROM (SELECT encode(sha256(convert_to('gappd-meeting-v1:'||owner||':'||local_id,'UTF8')),'hex') h) s
$$;

CREATE TABLE cloud_meetings (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 title text NOT NULL CHECK (octet_length(title)<=512),
 summary text NOT NULL CHECK (octet_length(summary)<=4096),
 transcript text NOT NULL CHECK (octet_length(transcript)<=1048576),
 started_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 revision integer NOT NULL CHECK (revision>=1),
 document jsonb NOT NULL CHECK (octet_length(document::text)<=2097152)
);
ALTER TABLE cloud_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_meetings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cloud_meetings FROM PUBLIC;
CREATE INDEX cloud_meetings_expiry ON cloud_meetings(owner_id,started_at DESC);

-- A deletion marker and an accepted expiry outlive the copy itself and never expire.
CREATE TABLE meeting_lifecycle (
 id uuid NOT NULL,
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 local_id text NOT NULL CHECK (length(local_id) BETWEEN 1 AND 128),
 accepted_at timestamptz,
 expires_at timestamptz,
 deleted_at timestamptz,
 PRIMARY KEY (owner_id,id),
 CHECK (id=meeting_copy_id(owner_id,local_id)),
 CHECK ((accepted_at IS NULL AND expires_at IS NULL AND deleted_at IS NOT NULL)
  OR (accepted_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at=accepted_at+interval '720 hours'))
);
CREATE INDEX meeting_lifecycle_expiry ON meeting_lifecycle(expires_at,id);
ALTER TABLE meeting_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_lifecycle FORCE ROW LEVEL SECURITY;
REVOKE ALL ON meeting_lifecycle FROM PUBLIC;

CREATE FUNCTION protect_meeting_lifecycle() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
 OR NEW.local_id IS DISTINCT FROM OLD.local_id
 OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
 OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)) THEN
  RAISE EXCEPTION 'immutable lifecycle';
 END IF;
 IF TG_OP='INSERT' AND NEW.accepted_at>statement_timestamp() THEN
  RAISE EXCEPTION 'future acceptance';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_meeting_lifecycle BEFORE INSERT OR UPDATE ON meeting_lifecycle
 FOR EACH ROW EXECUTE FUNCTION protect_meeting_lifecycle();

-- An insert must find a live accepted lifecycle row. It never creates one, so a copy
-- cannot appear without an acceptance record, and a deleted or expired copy never returns.
CREATE FUNCTION guard_cloud_meeting_insert() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state meeting_lifecycle;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id,74812003));
 SELECT * INTO STRICT state FROM meeting_lifecycle WHERE id=NEW.id AND owner_id=NEW.owner_id FOR UPDATE;
 IF state.deleted_at IS NOT NULL OR state.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'cloud copy unavailable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_cloud_meeting_insert BEFORE INSERT ON cloud_meetings
 FOR EACH ROW EXECUTE FUNCTION guard_cloud_meeting_insert();

-- A real copy keeps its identity and only moves forward in revision.
CREATE FUNCTION guard_cloud_meeting_update() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state meeting_lifecycle;
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
  RAISE EXCEPTION 'immutable cloud copy';
 END IF;
 IF NEW.revision<=OLD.revision THEN
  RAISE EXCEPTION 'stale revision';
 END IF;
 SELECT * INTO STRICT state FROM meeting_lifecycle WHERE id=OLD.id AND owner_id=OLD.owner_id FOR UPDATE;
 IF state.deleted_at IS NOT NULL OR state.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'cloud copy unavailable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_cloud_meeting_update BEFORE UPDATE ON cloud_meetings
 FOR EACH ROW EXECUTE FUNCTION guard_cloud_meeting_update();

-- The reader sees only live copies. The lifecycle policy is what makes the subquery work.
CREATE POLICY cloud_meeting_owner ON cloud_meetings FOR SELECT
 USING (current_user='gappd_reader' AND owner_id=current_setting('app.owner_id',true)
 AND EXISTS (SELECT FROM meeting_lifecycle l WHERE l.id=cloud_meetings.id AND l.owner_id=cloud_meetings.owner_id
  AND l.deleted_at IS NULL AND l.expires_at>statement_timestamp()));
CREATE POLICY meeting_lifecycle_owner ON meeting_lifecycle FOR SELECT
 USING (current_user='gappd_reader' AND owner_id=current_setting('app.owner_id',true));

-- Existing deployments already hold the reader role. Fresh databases grant in Provision.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_reader') THEN
  GRANT SELECT ON cloud_meetings, meeting_lifecycle TO gappd_reader;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (4);
