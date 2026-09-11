package db

import (
	"context"
	"database/sql"
)

// Discard pre-release, unversioned evidence; it cannot prove user confirmation.
func migrateVoiceEvidence(ctx context.Context, conn *sql.Conn) error {
	columns, err := tableColumns(ctx, conn, "meeting_speaker_embeddings")
	if err != nil {
		return err
	}
	if len(columns) > 0 && !columns["model"] {
		if _, err := conn.ExecContext(ctx, `DROP TABLE meeting_speaker_embeddings`); err != nil {
			return err
		}
	}
	_, err = conn.ExecContext(ctx, `DROP TABLE IF EXISTS person_voice_profiles`)
	return err
}
