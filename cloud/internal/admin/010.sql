-- Migration 010: the cleanup backlog, as two aggregate numbers.
-- The 24-hour physical cleanup deadline is a promise, and nothing could observe it: the reader
-- cannot see expired rows, and every runtime read is owner scoped. This function returns counts
-- and nothing else, so it cannot become a way to read a row.

CREATE FUNCTION cleanup_backlog() RETURNS TABLE(expired_copies bigint, oldest_expired_seconds double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT count(*), coalesce(max(extract(epoch FROM (statement_timestamp()-l.expires_at))),0)
 FROM meeting_lifecycle l JOIN cloud_meetings m ON m.id=l.id AND m.owner_id=l.owner_id
 WHERE l.expires_at<=statement_timestamp() AND l.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION cleanup_backlog() FROM PUBLIC;

-- Existing deployments already hold the reader role. Fresh databases grant in Provision.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_reader') THEN
  GRANT EXECUTE ON FUNCTION cleanup_backlog() TO gappd_reader;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (10);
