package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
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
	Language     string
}

// personFactTargetSQL selects a Meeting m with current notes whose transcript revision still needs
// Person facts. A skipped Meeting waits for QueueEarlierPersonFacts, also after a new transcript
// revision. Its arguments are ProcessingStatusCompleted and maxPersonFactAttempts.
const personFactTargetSQL = `m.processing_status=? AND json_valid(m.extraction_json) AND m.summary_transcript_revision=m.transcript_revision
 AND NOT EXISTS (SELECT 1 FROM person_fact_runs r WHERE r.meeting_id=m.id AND (r.state='skipped'
  OR (r.transcript_revision=m.transcript_revision AND (r.state<>'failed' OR r.attempts>=?))))`

// PersonFactMeetings counts the Meetings of one Person that were saved before Person facts and
// are not read (earlier), and the ones the background step still has to read (pending).
func (d *DB) PersonFactMeetings(personID string) (earlier, pending int, err error) {
	err = d.Conn.QueryRow(`SELECT
 (SELECT count(*) FROM meetings m JOIN person_fact_runs r ON r.meeting_id=m.id
  WHERE r.state='skipped' AND m.processing_status=? AND json_valid(m.extraction_json)
  AND m.id IN (SELECT meeting_id FROM meeting_speakers WHERE person_id=?)),
 (SELECT count(*) FROM meetings m WHERE `+personFactTargetSQL+` AND m.id IN (SELECT meeting_id FROM meeting_speakers WHERE person_id=?))`,
		ProcessingStatusCompleted, personID, ProcessingStatusCompleted, maxPersonFactAttempts, personID).Scan(&earlier, &pending)
	if err != nil {
		return 0, 0, fmt.Errorf("count meetings for facts of person %s: %w", personID, err)
	}
	return earlier, pending, nil
}

// QueueEarlierPersonFacts lets the background step read the earlier Meetings of one Person.
func (d *DB) QueueEarlierPersonFacts(personID string) error {
	_, err := d.Conn.Exec(`DELETE FROM person_fact_runs WHERE state='skipped'
 AND meeting_id IN (SELECT meeting_id FROM meeting_speakers WHERE person_id=?)`, personID)
	if err != nil {
		return fmt.Errorf("read earlier meetings of person %s: %w", personID, err)
	}
	return nil
}

// PersonSummary gives the saved About summary of a Person and the facts key it was written from.
func (d *DB) PersonSummary(personID string) (summary, factsKey string, err error) {
	err = d.Conn.QueryRow(`SELECT summary, facts_key FROM person_summaries WHERE person_id=?`, personID).Scan(&summary, &factsKey)
	if err == sql.ErrNoRows {
		return "", "", nil
	}
	if err != nil {
		return "", "", fmt.Errorf("read summary of person %s: %w", personID, err)
	}
	return summary, factsKey, nil
}

// SavePersonSummary saves the About summary written from the facts with factsKey.
func (d *DB) SavePersonSummary(personID, factsKey, summary string) error {
	_, err := d.Conn.Exec(`INSERT INTO person_summaries(person_id, facts_key, summary, updated_at) VALUES (?,?,?,?)
ON CONFLICT(person_id) DO UPDATE SET facts_key=excluded.facts_key, summary=excluded.summary, updated_at=excluded.updated_at`,
		personID, factsKey, summary, stamp(time.Now()))
	if err != nil {
		return fmt.Errorf("save summary of person %s: %w", personID, err)
	}
	return nil
}

// PersonFactsKey identifies the shown facts by their text, so a new read with the same facts
// keeps the summary.
func PersonFactsKey(facts []PersonFact) string {
	texts := make([]string, 0, len(facts))
	for _, fact := range facts {
		if !fact.Hidden {
			texts = append(texts, fact.Kind+":"+factText(fact.Text))
		}
	}
	slices.Sort(texts)
	sum := sha256.Sum256([]byte(strings.Join(texts, "\n")))
	return hex.EncodeToString(sum[:])
}

// PersonFactTargets lists Meetings with current notes whose transcript revision has no Person
// facts yet, newest first. A failed Meeting comes back until it failed maxPersonFactAttempts times.
func (d *DB) PersonFactTargets() ([]PersonFactTarget, error) {
	rows, err := d.Conn.Query(`SELECT m.id, m.transcript_revision, m.language FROM meetings m
WHERE `+personFactTargetSQL+`
ORDER BY EXISTS (SELECT 1 FROM person_fact_runs r WHERE r.meeting_id=m.id AND r.state='failed'), m.started_at DESC`, ProcessingStatusCompleted, maxPersonFactAttempts)
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
	if _, err = tx.ExecContext(ctx, `DELETE FROM person_facts WHERE meeting_id=?`, meetingID); err != nil {
		return false, fmt.Errorf("save person facts of meeting %s: %w", meetingID, err)
	}
	for _, fact := range facts {
		quotes, _ := json.Marshal(fact.Quotes)
		if _, err = tx.ExecContext(ctx, `INSERT INTO person_facts(meeting_id, speaker_key, kind, text, quotes_json) VALUES (?,?,?,?,?)`,
			meetingID, fact.SpeakerKey, fact.Kind, fact.Text, string(quotes)); err != nil {
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

// factText is the form two facts share when they say the same thing.
func factText(text string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(text), ". "))
}

// SetPersonFactHidden hides or shows a fact of a Person by its text, so every Meeting where the
// Person said it, now or later, follows the choice.
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
	query := `DELETE FROM person_hidden_facts WHERE person_id=? AND text_key=?`
	if hidden {
		query = `INSERT OR IGNORE INTO person_hidden_facts(person_id, text_key) VALUES (?,?)`
	}
	if _, err := d.Conn.Exec(query, personID, factText(text)); err != nil {
		return fmt.Errorf("hide fact %d: %w", factID, err)
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

// hiddenFactTexts gives the fact texts (factText form) that the user hid on a Person.
func (d *DB) hiddenFactTexts(personID string) (map[string]bool, error) {
	rows, err := d.Conn.Query(`SELECT text_key FROM person_hidden_facts WHERE person_id=?`, personID)
	if err != nil {
		return nil, fmt.Errorf("list hidden facts of person %s: %w", personID, err)
	}
	defer rows.Close()
	hidden := map[string]bool{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, fmt.Errorf("list hidden facts of person %s: %w", personID, err)
		}
		hidden[key] = true
	}
	return hidden, rows.Err()
}

// PersonFacts lists the facts of one Person, hidden ones too, newest Meeting first. A fact belongs
// to the Person labeled on its speaker in its Meeting, so a relabel or merge moves it without a
// new read. A fact repeated in several Meetings is listed once, from the newest.
func (d *DB) PersonFacts(personID string) ([]PersonFact, error) {
	rows, err := d.Conn.Query(`SELECT f.id, m.id, COALESCE(m.title,''), m.started_at, f.kind, f.text, f.quotes_json, m.language
FROM person_facts f
JOIN meeting_speakers s ON s.meeting_id=f.meeting_id AND s.speaker_key=f.speaker_key
JOIN meetings m ON m.id=f.meeting_id
WHERE s.person_id=?
ORDER BY m.started_at DESC, f.id`, personID)
	if err != nil {
		return nil, fmt.Errorf("list facts of person %s: %w", personID, err)
	}
	defer rows.Close()
	hidden, err := d.hiddenFactTexts(personID)
	if err != nil {
		return nil, err
	}
	facts := make([]PersonFact, 0)
	seen := map[string]bool{}
	for rows.Next() {
		var fact PersonFact
		var quotes string
		if err := rows.Scan(&fact.ID, &fact.MeetingID, &fact.MeetingTitle, &fact.StartedAt, &fact.Kind, &fact.Text, &quotes, &fact.Language); err != nil {
			return nil, fmt.Errorf("list facts of person %s: %w", personID, err)
		}
		key := factText(fact.Text)
		if seen[key] {
			continue
		}
		seen[key] = true
		fact.Hidden = hidden[key]
		_ = json.Unmarshal([]byte(quotes), &fact.Quotes)
		facts = append(facts, fact)
	}
	return facts, rows.Err()
}
