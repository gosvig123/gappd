package main

import (
	"os/signal"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/video"
	"github.com/spf13/cobra"
)

func appCompactVideoCmd() *cobra.Command {
	return meetingJSONCommand("compact-video", nil, func(_ []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		root, err := config.GappdDir()
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
		return writeJSON(appprotocol.CompactVideoResponse{Attempted: result.Attempted, SavedBytes: result.SavedBytes})
	})
}
