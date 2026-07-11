package meetingprocessing

import (
	"context"

	"github.com/gappd-dev/gappd/internal/db"
)

func (s Service) cleanupCompletedMeeting(ctx context.Context, meeting *db.Meeting) {
	if meeting.AudioPath == nil || *meeting.AudioPath == "" {
		return
	}
	store, ok := s.Store.(*db.DB)
	if !ok || s.deleteArtifact(*meeting.AudioPath) != nil {
		return
	}
	cleared, err := store.ClearAudioPath(ctx, meeting.ID, *meeting.AudioPath)
	if err == nil && cleared {
		meeting.AudioPath = nil
	}
}
