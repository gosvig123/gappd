-- Migration 012: remove the synthetic upload demo (migrations 002 and 003).
-- The administrator-seeded synthetic Meeting, its table and the read view remain.
-- Demo copies are fabricated text, so deleting them removes no user data.

DELETE FROM meetings WHERE id=demo_meeting_id(owner_id) OR id=selected_meeting_id(owner_id);

DROP TRIGGER guard_demo_content ON meetings;
DROP TRIGGER guard_selected_content ON meetings;

-- Policies from 003 and from the removed provision-demo and provision-cleanup commands.
DROP POLICY selected_mutation_read ON meetings;
DROP POLICY selected_insert ON meetings;
DROP POLICY selected_delete ON meetings;
DROP POLICY selected_cleanup_read ON meetings;
DROP POLICY selected_cleanup_delete ON meetings;
DROP POLICY IF EXISTS demo_mutation_read ON meetings;
DROP POLICY IF EXISTS demo_delete ON meetings;
DROP POLICY IF EXISTS synthetic_demo_insert ON meetings;
DROP POLICY IF EXISTS cleanup_read ON meetings;
DROP POLICY IF EXISTS cleanup_delete ON meetings;

-- Only administrator-seeded rows remain, so the reader sees its own rows without the demo lifecycle.
DROP POLICY meeting_owner ON meetings;
CREATE POLICY meeting_owner ON meetings FOR SELECT
 USING (current_user='gappd_reader' AND owner_id=current_setting('app.owner_id',true));

DROP TABLE demo_lifecycle;
DROP FUNCTION guard_demo_content();
DROP FUNCTION protect_demo_lifecycle();
DROP FUNCTION demo_meeting_id(text);
DROP FUNCTION selected_meeting_id(text);

-- Roles are cluster-wide and may hold grants in other databases, so this migration only removes
-- their access here. Drop gappd_demo_writer and gappd_demo_cleanup separately once unused.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_demo_writer') THEN
  REVOKE ALL ON meetings FROM gappd_demo_writer;
  REVOKE USAGE ON SCHEMA public FROM gappd_demo_writer;
 END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_demo_cleanup') THEN
  REVOKE ALL ON meetings FROM gappd_demo_cleanup;
  REVOKE USAGE ON SCHEMA public FROM gappd_demo_cleanup;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (12);
