package db

import (
	"database/sql"
	"fmt"
	"strings"
)

type Person struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

func (d *DB) ListPeople() ([]Person, error) {
	rows, err := d.Conn.Query(`SELECT id,name,email FROM people ORDER BY name COLLATE NOCASE,id`)
	if err != nil {
		return nil, fmt.Errorf("list saved people: %w", err)
	}
	defer rows.Close()
	people := make([]Person, 0)
	for rows.Next() {
		var person Person
		if err := rows.Scan(&person.ID, &person.Name, &person.Email); err != nil {
			return nil, err
		}
		people = append(people, person)
	}
	return people, rows.Err()
}

// UpdatePerson renames a Person or changes their email. A new name is written into
// every Meeting transcript that names them, and those summaries are refreshed.
func (d *DB) UpdatePerson(person Person) error {
	clean, err := cleanPerson(person)
	if err != nil {
		return fmt.Errorf("update person: %w", err)
	}
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin person update: %w", err)
	}
	defer tx.Rollback()
	current, err := findPerson(tx, clean.ID)
	if err != nil {
		return fmt.Errorf("update person: %w", err)
	}
	if err := checkEmailFree(tx, clean.Email, clean.ID); err != nil {
		return fmt.Errorf("update person: %w; merge the two People instead", err)
	}
	var meetings []string
	if current.Name != clean.Name {
		if meetings, err = personMeetings(tx, clean.ID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE people SET name=?,email=? WHERE id=?`, clean.Name, clean.Email, clean.ID); err != nil {
		return fmt.Errorf("update person %s: %w", clean.ID, err)
	}
	if err := refreshPersonMeetings(tx, meetings); err != nil {
		return err
	}
	return tx.Commit()
}

// MergePeople moves every speaker label and voice sample of mergeID to the kept
// Person, deletes mergeID, and saves the chosen name and email on the kept Person.
func (d *DB) MergePeople(kept Person, mergeID string) error {
	clean, err := cleanPerson(kept)
	if err != nil {
		return fmt.Errorf("merge people: %w", err)
	}
	if clean.ID == mergeID {
		return fmt.Errorf("merge people: choose two different People")
	}
	tx, err := d.Conn.Begin()
	if err != nil {
		return fmt.Errorf("begin people merge: %w", err)
	}
	defer tx.Rollback()
	keptBefore, err := findPerson(tx, clean.ID)
	if err != nil {
		return fmt.Errorf("merge people: %w", err)
	}
	merged, err := findPerson(tx, mergeID)
	if err != nil {
		return fmt.Errorf("merge people: %w", err)
	}
	if err := checkEmailFree(tx, clean.Email, clean.ID, mergeID); err != nil {
		return fmt.Errorf("merge people: %w", err)
	}
	meetings, err := renamedMeetings(tx, clean.Name, keptBefore, merged)
	if err != nil {
		return err
	}
	if err := moveSpeakerLabels(tx, mergeID, clean.ID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM people WHERE id=?`, mergeID); err != nil {
		return fmt.Errorf("merge people: delete %s: %w", mergeID, err)
	}
	if _, err := tx.Exec(`UPDATE people SET name=?,email=? WHERE id=?`, clean.Name, clean.Email, clean.ID); err != nil {
		return fmt.Errorf("merge people: update %s: %w", clean.ID, err)
	}
	if err := refreshPersonMeetings(tx, meetings); err != nil {
		return err
	}
	return tx.Commit()
}

func resolvePerson(tx *sql.Tx, person Person) (Person, error) {
	if person.ID != "" {
		return findPerson(tx, person.ID)
	}
	person, err := cleanPerson(person)
	if err != nil {
		return person, fmt.Errorf("save person: %w", err)
	}
	if person.Email != "" {
		err := tx.QueryRow(`SELECT id,name,email FROM people WHERE email=?`, person.Email).Scan(&person.ID, &person.Name, &person.Email)
		if err != sql.ErrNoRows {
			return person, err
		}
	}
	return insertPerson(tx, person)
}

func cleanPerson(person Person) (Person, error) {
	person.Name, person.Email = strings.TrimSpace(person.Name), strings.ToLower(strings.TrimSpace(person.Email))
	if person.Name == "" || len(person.Name) > 200 || strings.ContainsAny(person.Name, "\r\n") {
		return person, fmt.Errorf("enter a name of 1–200 characters")
	}
	local, domain, found := strings.Cut(person.Email, "@")
	if person.Email != "" && (!found || local == "" || domain == "" || len(person.Email) > 320 || strings.ContainsAny(person.Email, " \t\r\n")) {
		return person, fmt.Errorf("enter a valid email or leave it empty")
	}
	return person, nil
}

func findPerson(tx *sql.Tx, id string) (Person, error) {
	var person Person
	err := tx.QueryRow(`SELECT id,name,email FROM people WHERE id=?`, id).Scan(&person.ID, &person.Name, &person.Email)
	if err == sql.ErrNoRows {
		return person, fmt.Errorf("person %s not found; reload People", id)
	}
	return person, err
}

func checkEmailFree(tx *sql.Tx, email string, owners ...string) error {
	if email == "" {
		return nil
	}
	var id, name string
	err := tx.QueryRow(`SELECT id,name FROM people WHERE email=?`, email).Scan(&id, &name)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	for _, owner := range owners {
		if id == owner {
			return nil
		}
	}
	return fmt.Errorf("%s already belongs to %s", email, name)
}

func insertPerson(tx *sql.Tx, person Person) (Person, error) {
	id, err := newID()
	if err != nil {
		return person, err
	}
	person.ID = id
	_, err = tx.Exec(`INSERT INTO people(id,name,email) VALUES (?,?,?)`, person.ID, person.Name, person.Email)
	return person, err
}

// renamedMeetings lists the Meetings whose transcript will show a different name after a merge.
func renamedMeetings(tx *sql.Tx, name string, people ...Person) ([]string, error) {
	var meetings []string
	for _, person := range people {
		if person.Name == name {
			continue
		}
		ids, err := personMeetings(tx, person.ID)
		if err != nil {
			return nil, err
		}
		meetings = append(meetings, ids...)
	}
	return meetings, nil
}

func personMeetings(tx *sql.Tx, personID string) ([]string, error) {
	rows, err := tx.Query(`SELECT DISTINCT ms.meeting_id FROM meeting_speakers ms JOIN meetings m ON m.id=ms.meeting_id
 WHERE ms.person_id=? AND m.capture_status=? AND m.transcript IS NOT NULL AND m.diarization_state NOT IN (?,?)`,
		personID, CaptureStatusCaptured, DiarizationStatePending, DiarizationStateProcessing)
	if err != nil {
		return nil, fmt.Errorf("list Meetings of person %s: %w", personID, err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// moveSpeakerLabels keeps voice samples: the retract trigger on meeting_speakers deletes
// them when person_id changes, so they are saved first and written back for the kept Person.
func moveSpeakerLabels(tx *sql.Tx, fromID, toID string) error {
	rows, err := tx.Query(`SELECT meeting_id,speaker_key FROM voice_samples WHERE person_id=?`, fromID)
	if err != nil {
		return fmt.Errorf("merge people: read voice samples: %w", err)
	}
	var samples [][2]string
	for rows.Next() {
		var sample [2]string
		if err := rows.Scan(&sample[0], &sample[1]); err != nil {
			rows.Close()
			return err
		}
		samples = append(samples, sample)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE meeting_speakers SET person_id=? WHERE person_id=?`, toID, fromID); err != nil {
		return fmt.Errorf("merge people: move speaker labels: %w", err)
	}
	for _, sample := range samples {
		if _, err := tx.Exec(`INSERT INTO voice_samples(meeting_id,speaker_key,person_id) VALUES(?,?,?)`, sample[0], sample[1], toID); err != nil {
			return fmt.Errorf("merge people: keep voice sample: %w", err)
		}
	}
	return nil
}

func refreshPersonMeetings(tx *sql.Tx, meetingIDs []string) error {
	seen := make(map[string]bool)
	for _, id := range meetingIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		if err := refreshSpeakerTranscript(tx, id); err != nil {
			return fmt.Errorf("refresh transcript of Meeting %s: %w", id, err)
		}
	}
	return nil
}

// ImportPeople saves contacts that have a valid email and no Person yet; a contact without a
// name is saved under its email. A contact also
// fills the email of the only Person with the same name and no email, instead of a duplicate.
// Names do not change, so no transcript needs a processing pass.
func (d *DB) ImportPeople(contacts []Person) (added, updated int, err error) {
	tx, err := d.Conn.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	for _, contact := range contacts {
		if strings.TrimSpace(contact.Name) == "" {
			contact.Name = contact.Email
		}
		contact, err := cleanPerson(Person{Name: contact.Name, Email: contact.Email})
		if err != nil || contact.Email == "" {
			continue
		}
		var taken int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM people WHERE email=?`, contact.Email).Scan(&taken); err != nil {
			return 0, 0, fmt.Errorf("import people: check %s: %w", contact.Email, err)
		}
		if taken > 0 {
			continue
		}
		filled, err := tx.Exec(`UPDATE people SET email=? WHERE email='' AND name=? COLLATE NOCASE
 AND (SELECT COUNT(*) FROM people WHERE email='' AND name=? COLLATE NOCASE)=1`, contact.Email, contact.Name, contact.Name)
		if err != nil {
			return 0, 0, fmt.Errorf("import people: fill email of %s: %w", contact.Name, err)
		}
		if rows, _ := filled.RowsAffected(); rows > 0 {
			updated++
			continue
		}
		if _, err := insertPerson(tx, contact); err != nil {
			return 0, 0, fmt.Errorf("import people: save %s: %w", contact.Email, err)
		}
		added++
	}
	return added, updated, tx.Commit()
}
