-- Migration 015: Usage report totals for the private stats dashboard.
-- The table stays owner-only. This function returns the daily totals of the last 400 days and
-- leaves out every total under 5, because a smaller number can describe a single person.

CREATE FUNCTION usage_totals() RETURNS TABLE(day date, field text, value text, reports bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT u.day, u.field, u.value, u.reports FROM usage_daily u
 WHERE u.reports>=5 AND u.day>(statement_timestamp() AT TIME ZONE 'UTC')::date-400
 ORDER BY u.day, u.field, u.value
$$;
REVOKE ALL ON FUNCTION usage_totals() FROM PUBLIC;

-- Existing deployments already hold the reader role. Fresh databases grant in Provision.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_reader') THEN
  GRANT EXECUTE ON FUNCTION usage_totals() TO gappd_reader;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (15);
