-- Migration 014: anonymous Usage reports, as daily totals only.
-- The desktop app can send one Usage report per day, without an account, device or install id.
-- No report is stored: record_usage adds one to the total of each field value for the day the
-- server received it. Totals are per field, so even an administrator cannot combine two fields of
-- one report. Only the owner can read the table.

CREATE TABLE usage_daily (
 day date NOT NULL,
 field text NOT NULL CHECK (length(field) BETWEEN 1 AND 64),
 value text NOT NULL CHECK (length(value) BETWEEN 1 AND 64),
 reports bigint NOT NULL CHECK (reports > 0),
 PRIMARY KEY (day, field, value)
);
REVOKE ALL ON usage_daily FROM PUBLIC;

-- The server sets the day, so a report cannot choose where it is counted.
CREATE FUNCTION record_usage(fields text[], vals text[]) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 INSERT INTO usage_daily(day,field,value,reports)
 SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date, f, v, 1 FROM unnest(fields, vals) AS u(f,v)
 ON CONFLICT (day,field,value) DO UPDATE SET reports=usage_daily.reports+1
$$;
REVOKE ALL ON FUNCTION record_usage(text[],text[]) FROM PUBLIC;

-- Existing deployments already hold the writer role. Fresh databases grant in provision-meeting.
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='gappd_meeting_writer') THEN
  GRANT EXECUTE ON FUNCTION record_usage(text[],text[]) TO gappd_meeting_writer;
 END IF;
END $$;

INSERT INTO cloud_migrations VALUES (14);
