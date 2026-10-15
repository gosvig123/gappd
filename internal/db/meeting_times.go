package db

// MeetingTime is when one recorded Meeting with a transcript started and ended.
type MeetingTime struct {
	StartedAt string
	EndedAt   string
}

// MeetingTimes lists recorded Meetings with a transcript, oldest first, so Calendar sync can fetch
// the history around them.
func (d *DB) MeetingTimes() ([]MeetingTime, error) {
	rows, err := d.Conn.Query(`SELECT started_at,COALESCE(ended_at,'') FROM meetings
 WHERE capture_status=? AND transcript IS NOT NULL AND trim(transcript)<>''
 ORDER BY started_at,id`, CaptureStatusCaptured)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	times := make([]MeetingTime, 0)
	for rows.Next() {
		var entry MeetingTime
		if err := rows.Scan(&entry.StartedAt, &entry.EndedAt); err != nil {
			return nil, err
		}
		times = append(times, entry)
	}
	return times, rows.Err()
}
