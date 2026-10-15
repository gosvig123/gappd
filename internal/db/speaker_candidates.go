package db

import (
	"database/sql"
	"fmt"
	"strings"
)

// Calendar candidates are exact constraints. Only manual remote anchors can expand a known group.
func candidatePeople(tx *sql.Tx, meetingID string, emails []string, calendar bool) ([]string, error) {
	if len(emails) > 100 {
		return nil, fmt.Errorf("recognize speakers: too many invitees")
	}
	if calendar {
		values := uniqueEmails(emails)
		if len(values) == 0 {
			return nil, nil
		}
		query, args := inQuery(`SELECT id FROM people WHERE lower(trim(email)) IN (%s)`, values)
		return queryPersonIDs(tx, query, args...)
	}
	return queryPersonIDs(tx, `SELECT DISTINCT previous.person_id FROM meeting_speakers anchor
 JOIN meeting_speakers attendance ON attendance.person_id=anchor.person_id
 JOIN meeting_speakers previous ON previous.meeting_id=attendance.meeting_id
 JOIN meetings past ON past.id=previous.meeting_id AND past.capture_status='captured' AND past.diarization_state='completed'
 WHERE anchor.meeting_id=? AND attendance.meeting_id<>? AND anchor.speaker_key GLOB 'Speaker [1-9]*'
 AND attendance.speaker_key GLOB 'Speaker [1-9]*' AND previous.speaker_key GLOB 'Speaker [1-9]*'
 AND NOT EXISTS(SELECT 1 FROM speaker_identity_state st WHERE st.meeting_id=anchor.meeting_id AND st.speaker_key=anchor.speaker_key AND st.origin<>'manual')
 AND NOT EXISTS(SELECT 1 FROM speaker_identity_state st WHERE st.meeting_id=attendance.meeting_id AND st.speaker_key=attendance.speaker_key AND st.origin<>'manual')
 AND NOT EXISTS(SELECT 1 FROM speaker_identity_state st WHERE st.meeting_id=previous.meeting_id AND st.speaker_key=previous.speaker_key AND st.origin<>'manual') LIMIT 101`, meetingID, meetingID)
}

func queryPersonIDs(tx *sql.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if len(ids) > 100 {
		return nil, nil
	}
	return ids, rows.Err()
}

func loadCandidateProfiles(tx *sql.Tx, meetingID string, emails []string, calendar bool) ([]voiceProfile, error) {
	ids, err := candidatePeople(tx, meetingID, emails, calendar)
	if err != nil || len(ids) == 0 {
		return nil, err
	}
	query, args := inQuery(`SELECT v.person_id,e.centroid FROM voice_samples v
 JOIN meeting_speaker_embeddings e USING(meeting_id,speaker_key)
 WHERE v.person_id IN (%s) AND e.model=? AND v.meeting_id<>? AND NOT EXISTS(
 SELECT 1 FROM meeting_speakers ms WHERE ms.meeting_id=? AND ms.person_id=v.person_id
 AND NOT EXISTS(SELECT 1 FROM speaker_identity_state st WHERE st.meeting_id=ms.meeting_id AND st.speaker_key=ms.speaker_key AND st.origin='automatic'))`, ids)
	args = append(args, VoiceModel, meetingID, meetingID)
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProfiles(rows)
}

func scanProfiles(rows *sql.Rows) ([]voiceProfile, error) {
	sums := map[string][]float64{}
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		vector, err := decodeCentroid(raw)
		if err != nil {
			continue
		}
		if sums[id] == nil {
			sums[id] = make([]float64, len(vector))
		}
		for i, value := range vector {
			sums[id][i] += value
		}
	}
	return normalizedProfiles(sums), rows.Err()
}

func normalizedProfiles(sums map[string][]float64) []voiceProfile {
	profiles := []voiceProfile{}
	for id, sum := range sums {
		vector, err := normalizeVoice(sum)
		if err == nil {
			profiles = append(profiles, voiceProfile{PersonID: id, Vector: vector})
		}
	}
	return profiles
}

func uniqueEmails(emails []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, email := range emails {
		email = strings.ToLower(strings.TrimSpace(email))
		if email != "" && !seen[email] {
			seen[email] = true
			out = append(out, email)
		}
	}
	return out
}

func inQuery(query string, values []string) (string, []any) {
	marks, args := make([]string, len(values)), make([]any, len(values))
	for i, value := range values {
		marks[i], args[i] = "?", value
	}
	return fmt.Sprintf(query, strings.Join(marks, ",")), args
}
