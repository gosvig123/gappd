package db

import (
	"fmt"
	"strings"
	"unicode"
)

// SearchMeetingIDs returns IDs of Meetings matching query across title, transcript, and summary
// using the SQLite FTS5 index with prefix matching on each word.
func (d *DB) SearchMeetingIDs(query string) ([]string, error) {
	match := ftsPrefixQuery(query)
	if match == "" {
		return []string{}, nil
	}
	rows, err := d.Conn.Query(`SELECT m.id FROM meetings_fts
		JOIN meetings m ON m.rowid = meetings_fts.rowid
		WHERE meetings_fts MATCH ?
		ORDER BY m.started_at DESC`, match)
	if err != nil {
		return nil, fmt.Errorf("search meetings: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan search meeting id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func ftsPrefixQuery(input string) string {
	var terms []string
	for _, field := range strings.Fields(input) {
		if !hasSearchableRune(field) {
			continue
		}
		escaped := strings.ReplaceAll(field, `"`, `""`)
		terms = append(terms, `"`+escaped+`"*`)
	}
	return strings.Join(terms, " ")
}

func hasSearchableRune(value string) bool {
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return true
		}
	}
	return false
}
