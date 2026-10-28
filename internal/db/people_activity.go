package db

import (
	"database/sql"
	"fmt"
)

// PersonActionItem is one action item from Meeting notes that a Person owns.
type PersonActionItem struct {
	MeetingID    string
	MeetingTitle string
	StartedAt    string
	Task         string
	Deadline     string
}

// PersonActionItems lists the action items a Person owns, newest Meeting first. Notes models get
// speaker keys instead of People names, so an owner key ("Speaker 2") counts in a Meeting where
// that key is labeled as this Person. Older notes name the owner, so the Person's full name counts
// in any Meeting.
func (d *DB) PersonActionItems(personID string) ([]PersonActionItem, error) {
	var name string
	err := d.Conn.QueryRow(`SELECT name FROM people WHERE id=?`, personID).Scan(&name)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("list action items: person %s not found; reload People", personID)
	}
	if err != nil {
		return nil, fmt.Errorf("list action items of person %s: %w", personID, err)
	}
	rows, err := d.Conn.Query(`SELECT m.id, COALESCE(m.title,''), m.started_at,
 json_extract(a.value,'$.task'), COALESCE(json_extract(a.value,'$.deadline'),'')
FROM meetings m, json_each(CASE WHEN json_valid(m.extraction_json) THEN m.extraction_json ELSE '{}' END, '$.action_items') a
WHERE COALESCE(json_extract(a.value,'$.task'),'') <> ''
 AND (lower(trim(json_extract(a.value,'$.owner'))) = lower(?)
  OR EXISTS (SELECT 1 FROM meeting_speakers s WHERE s.meeting_id=m.id AND s.person_id=?
   AND lower(s.speaker_key) = lower(trim(json_extract(a.value,'$.owner')))))
ORDER BY m.started_at DESC, CAST(a.key AS INTEGER)`, name, personID)
	if err != nil {
		return nil, fmt.Errorf("list action items of person %s: %w", personID, err)
	}
	defer rows.Close()
	items := make([]PersonActionItem, 0)
	for rows.Next() {
		var item PersonActionItem
		if err := rows.Scan(&item.MeetingID, &item.MeetingTitle, &item.StartedAt, &item.Task, &item.Deadline); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
