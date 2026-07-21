CREATE TABLE IF NOT EXISTS migrations (
    id        INTEGER PRIMARY KEY,
    name      TEXT    NOT NULL UNIQUE,
    applied_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS meetings (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    capture_status TEXT NOT NULL DEFAULT 'recording'
               CHECK (capture_status IN ('recording', 'captured', 'failed')),
    capture_status_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    capture_failure_message TEXT,
    processing_status TEXT NOT NULL DEFAULT 'pending'
               CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processing_status_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    processing_failure_message TEXT,
    processing_claim_token TEXT,
    processing_claim_expires_at TEXT,
    audio_path TEXT,
    transcript TEXT,
    transcript_revision INTEGER NOT NULL DEFAULT 0,
    summary    TEXT,
    summary_transcript_revision INTEGER NOT NULL DEFAULT 0,
    extraction_json TEXT,
    diarization_state TEXT NOT NULL DEFAULT 'not_requested'
               CHECK (diarization_state IN ('not_requested', 'not_applicable', 'pending', 'processing', 'completed', 'degraded')),
    diarization_error TEXT,
    diarization_json TEXT,
    language   TEXT NOT NULL DEFAULT 'en_US',
    tags       TEXT NOT NULL DEFAULT '[]',
    source     TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS segments (
    id         TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    start_sec  REAL NOT NULL,
    end_sec    REAL NOT NULL,
    text       TEXT NOT NULL,
    speaker    TEXT NOT NULL DEFAULT '',
    speaker_source TEXT,
    speaker_confidence REAL,
    speaker_assignment_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_segments_meeting_id    ON segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_started_at ON meetings(started_at);
CREATE INDEX IF NOT EXISTS idx_meetings_processing_queue ON meetings(processing_status, started_at);

CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
    title,
    transcript,
    summary,
    content='meetings',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS meetings_ai AFTER INSERT ON meetings BEGIN
    INSERT INTO meetings_fts(rowid, title, transcript, summary)
    VALUES (new.rowid, new.title, new.transcript, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS meetings_ad AFTER DELETE ON meetings BEGIN
    INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
    VALUES ('delete', old.rowid, old.title, old.transcript, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS meetings_au AFTER UPDATE ON meetings BEGIN
    INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
    VALUES ('delete', old.rowid, old.title, old.transcript, old.summary);
    INSERT INTO meetings_fts(rowid, title, transcript, summary)
    VALUES (new.rowid, new.title, new.transcript, new.summary);
END;
