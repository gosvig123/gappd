-- Preserve complete Meeting summaries without changing the document or transcript limits.
ALTER TABLE cloud_meetings DROP CONSTRAINT cloud_meetings_summary_check;
ALTER TABLE cloud_meetings ADD CONSTRAINT cloud_meetings_summary_check
 CHECK (octet_length(summary)<=65536);
INSERT INTO cloud_migrations VALUES (11);
