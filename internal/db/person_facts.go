package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// maxPersonFactAttempts is how often a failed Meeting is read again before it waits for a new
// transcript revision.
const maxPersonFactAttempts = 3

// PersonFactTarget is a Meeting whose current transcript still needs Person facts.
type PersonFactTarget struct {
	MeetingID          string
	TranscriptRevision int
	Language           string
}

// NewPersonFact is one fact to save, kept by speaker label.
type NewPersonFact struct {
	SpeakerKey string
	Kind       string
	Text       string
	Quotes     []string
}

// PersonFact is a saved fact about one Person, with the Meeting it comes from.
type PersonFact struct {
	ID           int64
	MeetingID    string
	MeetingTitle string
	StartedAt    string
	Kind         string
	Text         string
	Quotes       []string
	Hidden       bool
}

// PersonFactTargets lists Meetings with current notes whose transcript revision has no Person
// facts yet, newest first. A failed Meeting comes back until it failed maxPersonFactAttempts times.
func (d *DB) PersonFactTargets() ([]PersonFactTarget, error) {
	rows, err := d.Conn.Query(`SELECT m.id, m.transcript_revision, m.language FROM meetings m
LEFT JOIN person_fact_runs r ON r.meeting_id=m.id
WHERE m.processing_status=? AND json_valid(m.extraction_json) AND m.summary_transcript_revision=m.transcript_revision
 AND (r.meeting_id IS NULL OR r.transcript_revision<>m.transcript_revision OR (r.state='failed' AND r.attempts<?))
ORDER BY m.started_at DESC`, ProcessingStatusCompleted, maxPersonFactAttempts)
	if err != nil {
		return nil, fmt.Errorf("list meetings for person facts: %w", err)
	}
	defer rows.Close()
	targets := make([]PersonFactTarget, 0)
	for rows.Next() {
		var target PersonFactTarget
		if err := rows.Scan(&target.MeetingID, &target.TranscriptRevision, &target.Language); err != nil {
			return nil, fmt.Errorf("list meetings for person facts: %w", err)
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

// SavePersonFacts replaces the facts of one Meeting. It saves nothing and returns false when the
// transcript changed after it was read; the next pass reads the new revision.
func (d *DB) SavePersonFacts(ctx context.Context, meetingID string, revision int, facts []NewPersonFact) (saved bool, err error) {
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("save person facts of meeting %s: %w", meetingID, err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	current, err := transcriptRevisionIs(ctx, tx, meetingID, revision)
	if err != nil {
		return false, err
	}
	if !current {
		return false, tx.Rollback()
	}
	hidden, err := hiddenFactTexts(ctx, tx, meetingID)
	if err != nil {
		return false, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM person_facts WHERE meeting_id=?`, meetingID); err != nil {
		return false, fmt.Errorf("save person facts of meeting %s: %w", meetingID, err)
	}
	for _, fact := range facts {
		quotes, _ := json.Marshal(fact.Quotes)
		if _, err = tx.ExecContext(ctx, `INSERT INTO person_facts(meeting_id, speaker_key, kind, text, quotes_json, hidden) VALUES (?,?,?,?,?,?)`,
			meetingID, fact.SpeakerKey, fact.Kind, fact.Text, string(quotes), hidden[factKey(fact.SpeakerKey, fact.Text)]); err != nil {
			return false, fmt.Errorf("save person facts of meeting %s: %w", meetingID, err)
		}
	}
	if err = upsertPersonFactRun(ctx, tx, meetingID, revision, "done", ""); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// SavePersonFactsFailure records a failed read of one transcript revision.
func (d *DB) SavePersonFactsFailure(ctx context.Context, meetingID string, revision int, cause error) error {
	tx, err := d.Conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save person facts failure of meeting %s: %w", meetingID, err)
	}
	if err := upsertPersonFactRun(ctx, tx, meetingID, revision, "failed", cause.Error()); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// hiddenFactTexts gives the facts of a Meeting that the user hid, so a new read keeps them hidden.
func hiddenFactTexts(ctx context.Context, tx *sql.Tx, meetingID string) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `SELECT speaker_key, text FROM person_facts WHERE meeting_id=? AND hidden=1`, meetingID)
	if err != nil {
		return nil, fmt.Errorf("save person facts of meeting %s: %w", meetingID, err)
	}
	defer rows.Close()
	hidden := map[string]bool{}
	for rows.Next() {
		var speaker, text string
		if err := rows.Scan(&speaker, &text); err != nil {
			return nil, fmt.Errorf("save person facts of meeting %s: %w", meetingID, err)
		}
		hidden[factKey(speaker, text)] = true
	}
	return hidden, rows.Err()
}

func factKey(speaker, text string) string {
	return speaker + "\x00" + factText(text)
}

// factText is the form two facts share when they say the same thing.
func factText(text string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(text), ". "))
}

// SetPersonFactHidden hides or shows one fact of a Person, and every fact of that Person with
// the same text, because the Person page lists them once.
func (d *DB) SetPersonFactHidden(personID string, factID int64, hidden bool) error {
	var text string
	err := d.Conn.QueryRow(`SELECT f.text FROM person_facts f JOIN meeting_speakers s ON s.meeting_id=f.meeting_id AND s.speaker_key=f.speaker_key
WHERE f.id=? AND s.person_id=?`, factID, personID).Scan(&text)
	if err == sql.ErrNoRows {
		return fmt.Errorf("hide fact %d: it is not a fact of person %s; reload the Person page", factID, personID)
	}
	if err != nil {
		return fmt.Errorf("hide fact %d: %w", factID, err)
	}
	rows, err := d.Conn.Query(`SELECT f.id, f.text FROM person_facts f JOIN meeting_speakers s ON s.meeting_id=f.meeting_id AND s.speaker_key=f.speaker_key
WHERE s.person_id=?`, personID)
	if err != nil {
		return fmt.Errorf("hide fact %d: %w", factID, err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		var other string
		if err := rows.Scan(&id, &other); err != nil {
			rows.Close()
			return fmt.Errorf("hide fact %d: %w", factID, err)
		}
		if factText(other) == factText(text) {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		if _, err := d.Conn.Exec(`UPDATE person_facts SET hidden=? WHERE id=?`, hidden, id); err != nil {
			return fmt.Errorf("hide fact %d: %w", factID, err)
		}
	}
	return nil
}

func transcriptRevisionIs(ctx context.Context, tx *sql.Tx, meetingID string, revision int) (bool, error) {
	var current int
	err := tx.QueryRowContext(ctx, `SELECT transcript_revision FROM meetings WHERE id=?`, meetingID).Scan(&current)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("save person facts of meeting %s: %w", meetingID, err)
	}
	return current == revision, nil
}

// upsertPersonFactRun counts attempts only for failures of the same revision.
func upsertPersonFactRun(ctx context.Context, tx *sql.Tx, meetingID string, revision int, state, message string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO person_fact_runs(meeting_id, transcript_revision, state, attempts, error, updated_at)
VALUES (?,?,?,CASE WHEN ?='failed' THEN 1 ELSE 0 END,NULLIF(?,''),?)
ON CONFLICT(meeting_id) DO UPDATE SET
 attempts=CASE WHEN excluded.state<>'failed' THEN 0
  WHEN person_fact_runs.state='failed' AND person_fact_runs.transcript_revision=excluded.transcript_revision THEN person_fact_runs.attempts+1
  ELSE 1 END,
 transcript_revision=excluded.transcript_revision, state=excluded.state, error=excluded.error, updated_at=excluded.updated_at`,
		meetingID, revision, state, state, message, stamp(time.Now()))
	if err != nil {
		return fmt.Errorf("save person facts state of meeting %s: %w", meetingID, err)
	}
	return nil
}

// PersonFacts lists the facts of one Person, hidden ones too, newest Meeting first. A fact belongs
// to the Person labeled on its speaker in its Meeting, so a relabel or merge moves it without a
// new read. A fact repeated in several Meetings is listed once, from the newest.
func (d *DB) PersonFacts(personID string) ([]PersonFact, error) {
	rows, err := d.Conn.Query(`SELECT f.id, m.id, COALESCE(m.title,''), m.started_at, f.kind, f.text, f.quotes_json, f.hidden
FROM person_facts f
JOIN meeting_speakers s ON s.meeting_id=f.meeting_id AND s.speaker_key=f.speaker_key
JOIN meetings m ON m.id=f.meeting_id
WHERE s.person_id=?
ORDER BY m.started_at DESC, f.id`, personID)
	if err != nil {
		return nil, fmt.Errorf("list facts of person %s: %w", personID, err)
	}
	defer rows.Close()
	facts := make([]PersonFact, 0)
	seen := map[string]bool{}
	for rows.Next() {
		var fact PersonFact
		var quotes string
		if err := rows.Scan(&fact.ID, &fact.MeetingID, &fact.MeetingTitle, &fact.StartedAt, &fact.Kind, &fact.Text, &quotes, &fact.Hidden); err != nil {
			return nil, fmt.Errorf("list facts of person %s: %w", personID, err)
		}
		key := factText(fact.Text)
		if seen[key] {
			continue
		}
		seen[key] = true
		_ = json.Unmarshal([]byte(quotes), &fact.Quotes)
		facts = append(facts, fact)
	}
	return facts, rows.Err()
}
