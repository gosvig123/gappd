package main

import (
	"os/signal"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/video"
	"github.com/spf13/cobra"
)

// appCompactStorageCmd frees disk space of finished Meetings: leftover Live Transcript chunks, then one Screen video.
func appCompactStorageCmd() *cobra.Command {
	return meetingJSONCommand("compact-storage", nil, func(_ []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		root, err := config.GappdDir()
		if err != nil {
			return err
		}
		freed, err := audioartifact.RemoveFinishedChunks(store, root)
		if err != nil {
			return err
		}
		// The desktop stops compaction with SIGTERM on quit; the helper must stop and leave the original movie.
		ctx, stop := signal.NotifyContext(cmdContext(), syscall.SIGTERM, syscall.SIGINT)
		defer stop()
		result, err := video.CompactNext(ctx, store, root, time.Now())
		if err != nil {
			return err
		}
		return writeJSON(appprotocol.CompactStorageResponse{Attempted: result.Attempted, SavedBytes: freed + result.SavedBytes})
	})
}
