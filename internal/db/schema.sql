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
    video_state TEXT NOT NULL DEFAULT 'off'
               CHECK (video_state IN ('off','selecting','cancelled','skipped','recording','ended','ready','failed','unfinished')),
    video_source_type TEXT CHECK (video_source_type IN ('window','display')),
    video_file TEXT CHECK (video_file IN ('screen.mov','screen.in-progress.mov')),
    video_start_sec REAL,
    video_end_sec REAL,
    video_message TEXT,
    video_origin_host_sec REAL,
    video_end_host_sec REAL,
    mic_start_host_sec REAL,
    system_start_host_sec REAL,
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
    title_source TEXT NOT NULL DEFAULT '' CHECK (title_source IN ('', 'calendar')),
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
    speaker_group_start_sec REAL,
    speaker_group_end_sec REAL,
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
    content_rowid='rowid',
    tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS meetings_ai AFTER INSERT ON meetings BEGIN
    INSERT INTO meetings_fts(rowid, title, transcript, summary)
    VALUES (new.rowid, new.title, new.transcript, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS meetings_ad AFTER DELETE ON meetings BEGIN
    INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
    VALUES ('delete', old.rowid, old.title, old.transcript, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS meetings_au AFTER UPDATE ON meetings
WHEN old.rowid IS NOT new.rowid
    OR old.title IS NOT new.title
    OR old.transcript IS NOT new.transcript
    OR old.summary IS NOT new.summary
BEGIN
    INSERT INTO meetings_fts(meetings_fts, rowid, title, transcript, summary)
    VALUES ('delete', old.rowid, old.title, old.transcript, old.summary);
    INSERT INTO meetings_fts(rowid, title, transcript, summary)
    VALUES (new.rowid, new.title, new.transcript, new.summary);
END;

CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_email ON people(email) WHERE email <> '';
CREATE TABLE IF NOT EXISTS meeting_speakers (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_key TEXT NOT NULL,
    person_id TEXT NOT NULL REFERENCES people(id),
    PRIMARY KEY (meeting_id, speaker_key)
);
CREATE TABLE IF NOT EXISTS meeting_speaker_embeddings (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_key TEXT NOT NULL,
    centroid TEXT NOT NULL,
    model TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (meeting_id, speaker_key)
);
CREATE TABLE IF NOT EXISTS speaker_identity_state (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_key TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('manual','automatic','cleared')),
    PRIMARY KEY(meeting_id,speaker_key)
);
CREATE TABLE IF NOT EXISTS voice_samples (
    meeting_id TEXT NOT NULL,
    speaker_key TEXT NOT NULL,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY(meeting_id,speaker_key),
    FOREIGN KEY(meeting_id,speaker_key) REFERENCES meeting_speakers(meeting_id,speaker_key) ON DELETE CASCADE,
    FOREIGN KEY(meeting_id,speaker_key) REFERENCES meeting_speaker_embeddings(meeting_id,speaker_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS speaker_suggestions (
    meeting_id TEXT NOT NULL,
    speaker_key TEXT NOT NULL,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY(meeting_id,speaker_key),
    FOREIGN KEY(meeting_id,speaker_key) REFERENCES meeting_speaker_embeddings(meeting_id,speaker_key) ON DELETE CASCADE
);
-- Person facts are kept by speaker label; meeting_speakers gives the Person labeled on it.
CREATE TABLE IF NOT EXISTS person_facts (
    id INTEGER PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    quotes_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_person_facts_speaker ON person_facts(meeting_id, speaker_key);
-- Fact texts (factText form) that the user hid on a Person. Kept apart from person_facts, so a new
-- read of a Meeting or the same fact from another Meeting stays hidden.
CREATE TABLE IF NOT EXISTS person_hidden_facts (
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    text_key TEXT NOT NULL,
    PRIMARY KEY (person_id, text_key)
);
-- The About summary of a Person, written from the text of their shown facts (facts_key).
CREATE TABLE IF NOT EXISTS person_summaries (
    person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
    facts_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
-- One row per Meeting whose transcript revision was read for Person facts. 'skipped' marks a
-- Meeting that existed before Person facts, which is read only on request.
CREATE TABLE IF NOT EXISTS person_fact_runs (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    transcript_revision INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('done','failed','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS retract_voice_assignment AFTER UPDATE OF person_id ON meeting_speakers
WHEN old.person_id IS NOT new.person_id BEGIN
    DELETE FROM voice_samples WHERE meeting_id=old.meeting_id AND speaker_key=old.speaker_key;
END;
CREATE TRIGGER IF NOT EXISTS retract_voice_segments AFTER DELETE ON segments BEGIN
    DELETE FROM meeting_speaker_embeddings WHERE meeting_id=old.meeting_id;
END;
CREATE TRIGGER IF NOT EXISTS retract_voice_retry AFTER UPDATE OF diarization_state ON meetings
WHEN new.diarization_state='pending' AND old.diarization_state<>'pending' BEGIN
    DELETE FROM meeting_speaker_embeddings WHERE meeting_id=new.id;
END;
