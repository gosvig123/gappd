-- Migration 013: remove the synthetic read slice (migrations 001 and 005).
-- The read tools now query cloud_meetings directly, whose own row level security scopes every
-- read to its owner. The seeded Meeting is fabricated text, so dropping it removes no user data.
-- Deploy a server that no longer reads cloud_read_meetings before applying this migration.

DROP VIEW cloud_read_meetings;
DROP TABLE meetings;

INSERT INTO cloud_migrations VALUES (13);
