-- Migration 005: the read surface that carries synthetic rows and owned cloud copies.
-- security_invoker is mandatory: without it the view is evaluated as its owner and would
-- bypass the row level security of both base tables.

CREATE VIEW cloud_read_meetings WITH (security_invoker=true) AS
 SELECT id,owner_id,title,summary,transcript,started_at,updated_at,synthetic FROM meetings WHERE synthetic
 UNION ALL
 SELECT id,owner_id,title,summary,transcript,started_at,updated_at,false FROM cloud_meetings;

-- Existing deployments already hold the reader role. Fresh databases grant in Provision.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_reader') THEN
  GRANT SELECT ON cloud_read_meetings TO gappd_reader;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (5);
