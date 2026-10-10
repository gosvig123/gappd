package db

type VoiceTarget struct {
	ID       string `json:"id"`
	Revision int    `json:"revision"`
}

// Keyset pagination includes old Meetings without changing the history list contract.
func (d *DB) VoiceTargets(after string) ([]VoiceTarget, error) {
	rows, err := d.Conn.Query(`SELECT id,transcript_revision FROM meetings m WHERE id>?
 AND capture_status='captured' AND diarization_state='completed' AND (`+voiceProcessingAvailableSQL+`)
 AND (EXISTS(SELECT 1 FROM meeting_speaker_embeddings e WHERE e.meeting_id=m.id)
 OR EXISTS(SELECT 1 FROM speaker_identity_state st WHERE st.meeting_id=m.id AND st.origin='automatic'))
 ORDER BY id LIMIT 100`, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VoiceTarget{}
	for rows.Next() {
		var target VoiceTarget
		if err := rows.Scan(&target.ID, &target.Revision); err != nil {
			return nil, err
		}
		out = append(out, target)
	}
	return out, rows.Err()
}

// Match the queue's five-minute legacy lease rule without changing identities on reads.
const voiceProcessingAvailableSQL = `processing_status<>'processing' OR
 (processing_claim_token IS NULL AND processing_status_updated_at<=strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 minutes')) OR
 (processing_claim_token IS NOT NULL AND (processing_claim_expires_at IS NULL OR
 processing_claim_expires_at<=strftime('%Y-%m-%dT%H:%M:%SZ','now')))`
