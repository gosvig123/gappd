CREATE FUNCTION selected_meeting_id(owner text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (substr(h,1,12)||'8'||substr(h,14,3)||
 substr('89ab', ((get_byte(decode(h,'hex'),8) >> 4) & 3)+1,1)||substr(h,18,15))::uuid
 FROM (SELECT encode(sha256(convert_to('gappd-selected-local-fixture-v1:'||owner,'UTF8')),'hex') h) s
$$;
ALTER TABLE demo_lifecycle DROP CONSTRAINT demo_lifecycle_check;
ALTER TABLE demo_lifecycle ADD CONSTRAINT demo_lifecycle_check
 CHECK (id=demo_meeting_id(owner_id) OR id=selected_meeting_id(owner_id));
CREATE TRIGGER guard_selected_content BEFORE INSERT ON meetings
 FOR EACH ROW WHEN (NEW.id=selected_meeting_id(NEW.owner_id)) EXECUTE FUNCTION guard_demo_content();
CREATE POLICY selected_mutation_read ON meetings FOR SELECT USING (
 current_user='gappd_demo_writer' AND owner_id=current_setting('app.owner_id',true) AND id=selected_meeting_id(owner_id));
CREATE POLICY selected_insert ON meetings FOR INSERT WITH CHECK (
 current_user='gappd_demo_writer' AND owner_id=current_setting('app.owner_id',true) AND id=selected_meeting_id(owner_id)
 AND title='SYNTHETIC: Selected local Meeting'
 AND summary='Fabricated participants will review a fictional paper prototype.'
 AND transcript='[00:00] Synthetic speaker: Review the fictional paper prototype.'
 AND started_at='2026-09-14T12:00:00Z' AND updated_at=started_at AND synthetic=true);
CREATE POLICY selected_delete ON meetings FOR DELETE USING (
 current_user='gappd_demo_writer' AND owner_id=current_setting('app.owner_id',true) AND id=selected_meeting_id(owner_id)
 AND EXISTS(SELECT FROM demo_lifecycle l WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id AND l.deleted_at IS NOT NULL));
CREATE POLICY selected_cleanup_read ON meetings FOR SELECT USING (
 current_user='gappd_demo_cleanup' AND id=selected_meeting_id(owner_id)
 AND EXISTS(SELECT FROM demo_lifecycle l WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id AND l.expires_at<=statement_timestamp()));
CREATE POLICY selected_cleanup_delete ON meetings FOR DELETE USING (
 current_user='gappd_demo_cleanup' AND id=selected_meeting_id(owner_id)
 AND EXISTS(SELECT FROM demo_lifecycle l WHERE l.id=meetings.id AND l.owner_id=meetings.owner_id AND l.expires_at<=statement_timestamp() AND l.deleted_at IS NOT NULL));
INSERT INTO cloud_migrations VALUES (3);
