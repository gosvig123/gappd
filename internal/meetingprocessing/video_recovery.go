package meetingprocessing

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/video"
)

func (r Recovery) recoverVideo(ctx context.Context, cutoff string) error {
	store, ok := r.Store.(*db.DB)
	if !ok {
		return nil
	}
	meetings, err := store.ListInterruptedVideoMeetings(cutoff, 20)
	if err != nil {
		return err
	}
	for _, meeting := range meetings {
		if meeting.AudioPath == nil {
			continue
		}
		partial, err := video.ManagedFile(*meeting.AudioPath, db.VideoPartialFile)
		alreadyFinal := false
		if err != nil {
			partial, err = video.ManagedFile(*meeting.AudioPath, db.VideoFile)
			alreadyFinal = err == nil
		}
		if err != nil {
			message := "Unfinished Screen video was not found or is unsafe to open."
			if updateErr := store.UpdateMeetingVideo(meeting.ID, db.VideoUpdate{State: "failed", Message: &message}); updateErr != nil {
				return updateErr
			}
			continue
		}
		if meeting.VideoOriginHostSec == nil || (meeting.MicStartHostSec == nil && meeting.SystemStartHostSec == nil) {
			if err := os.Remove(partial); err != nil {
				return fmt.Errorf("remove unsynchronized video: %w", err)
			}
			message := "Unfinished Screen video had no measured audio/video time origin and was removed."
			if err := store.UpdateMeetingVideo(meeting.ID, db.VideoUpdate{State: "failed", Message: &message}); err != nil {
				return err
			}
			continue
		}
		duration, err := video.Inspect(ctx, partial)
		if err != nil {
			if removeErr := os.Remove(partial); removeErr != nil {
				return fmt.Errorf("remove invalid video: %w", removeErr)
			}
			message := "Unfinished Screen video could not be played and was removed."
			if updateErr := store.UpdateMeetingVideo(meeting.ID, db.VideoUpdate{State: "failed", Message: &message}); updateErr != nil {
				return updateErr
			}
			continue
		}
		if !alreadyFinal {
			final := filepath.Join(*meeting.AudioPath, db.VideoFile)
			if _, err := os.Lstat(final); err == nil {
				return fmt.Errorf("refuse to replace existing managed video for Meeting %s", meeting.ID)
			} else if !os.IsNotExist(err) {
				return err
			}
			if err := os.Rename(partial, final); err != nil {
				return err
			}
		}
		name := db.VideoFile
		update := db.VideoUpdate{State: "ended", File: &name}
		if meeting.VideoOriginHostSec != nil {
			end := *meeting.VideoOriginHostSec + duration
			update.EndHostSec = &end
		}
		if err := store.UpdateMeetingVideo(meeting.ID, update); err != nil {
			return err
		}
		if err := store.UpdateVideoInterval(meeting.ID); err != nil {
			return err
		}
	}
	return nil
}
