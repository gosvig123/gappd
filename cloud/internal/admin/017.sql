-- Migration 017: weekly Usage report totals for the private stats dashboard.
-- A day rarely has 5 reports of one value, so daily totals hid almost everything. Each row is now
-- one ISO week (`day` holds its Monday) of the last 400 days. Weeks do not overlap and the filter
-- runs after the sum, so no total under 5 can be found by subtracting one row from another.
-- To go back to daily totals, run the function body of migration 015 again.

CREATE OR REPLACE FUNCTION usage_totals() RETURNS TABLE(day date, field text, value text, reports bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT date_trunc('week',u.day)::date, u.field, u.value, sum(u.reports)::bigint FROM usage_daily u
 WHERE u.day>(statement_timestamp() AT TIME ZONE 'UTC')::date-400
 GROUP BY 1,2,3 HAVING sum(u.reports)>=5
 ORDER BY 1,2,3
$$;

INSERT INTO cloud_migrations VALUES (17);
