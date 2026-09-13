CREATE FUNCTION demo_meeting_id(owner text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (substr(h,1,12)||'8'||substr(h,14,3)||
 substr('89ab', ((get_byte(decode(h,'hex'),8) >> 4) & 3)+1,1)||substr(h,18,15))::uuid
 FROM (SELECT encode(sha256(convert_to('gappd-synthetic-upload-v1:'||owner,'UTF8')),'hex') h) s
$$;
CREATE TABLE demo_lifecycle (
 id uuid NOT NULL,
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 accepted_at timestamptz,
 expires_at timestamptz,
 deleted_at timestamptz,
 PRIMARY KEY (owner_id,id),
 CHECK (id=demo_meeting_id(owner_id)),
 CHECK ((accepted_at IS NULL AND expires_at IS NULL AND deleted_at IS NOT NULL)
 OR (accepted_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at=accepted_at+interval '720 hours'))
);
CREATE INDEX demo_lifecycle_expiry ON demo_lifecycle(expires_at,id);
ALTER TABLE demo_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_lifecycle FORCE ROW LEVEL SECURITY;
REVOKE ALL ON demo_lifecycle FROM PUBLIC;
CREATE POLICY lifecycle_owner ON demo_lifecycle
 USING (current_user IN ('gappd_reader','gappd_demo_writer') AND owner_id=current_setting('app.owner_id',true))
 WITH CHECK (current_user IN ('gappd_reader','gappd_demo_writer') AND owner_id=current_setting('app.owner_id',true));
CREATE FUNCTION protect_demo_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
 OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
 OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)) THEN
  RAISE EXCEPTION 'immutable lifecycle';
 END IF;
 IF TG_OP='INSERT' AND NEW.accepted_at>statement_timestamp() THEN
  RAISE EXCEPTION 'future acceptance';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_demo_lifecycle BEFORE INSERT OR UPDATE ON demo_lifecycle
 FOR EACH ROW EXECUTE FUNCTION protect_demo_lifecycle();
CREATE FUNCTION guard_demo_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state demo_lifecycle;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id,74812002));
 IF EXISTS (SELECT FROM meetings WHERE id=NEW.id AND owner_id=NEW.owner_id)
 AND NOT EXISTS (SELECT FROM demo_lifecycle WHERE id=NEW.id AND owner_id=NEW.owner_id) THEN
  RAISE EXCEPTION 'legacy acceptance required';
 END IF;
 INSERT INTO demo_lifecycle(id,owner_id,accepted_at,expires_at)
 VALUES (NEW.id,NEW.owner_id,statement_timestamp(),statement_timestamp()+interval '720 hours')
 ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT state FROM demo_lifecycle WHERE id=NEW.id AND owner_id=NEW.owner_id FOR UPDATE;
 IF state.deleted_at IS NOT NULL OR state.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'demo unavailable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_demo_content BEFORE INSERT ON meetings
 FOR EACH ROW WHEN (NEW.id=demo_meeting_id(NEW.owner_id)) EXECUTE FUNCTION guard_demo_content();
DROP POLICY meeting_owner ON meetings;
CREATE POLICY meeting_owner ON meetings FOR SELECT USING (
 current_user='gappd_reader' AND owner_id=current_setting('app.owner_id',true) AND
 (id='b47c5e70-8030-4b9e-bb5a-146d17c68731' OR EXISTS (
 SELECT FROM demo_lifecycle l WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id
 AND l.deleted_at IS NULL AND l.expires_at>statement_timestamp())));
INSERT INTO cloud_migrations VALUES (2);
