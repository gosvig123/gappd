package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/liveactions"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/spf13/cobra"
)

func appGenerateLiveActionsCmd() *cobra.Command {
	return meetingJSONCommand("generate-live-actions [meeting-id]", cobra.ExactArgs(1), func(args []string) error {
		cfg, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		pipeline, err := processingPipeline(cfg, meetingprocessing.CapabilitySummarization)
		if err != nil {
			return err
		}
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		draft, err := (liveactions.Module{Store: store, Extractor: pipeline}).Generate(ctx, args[0])
		if err != nil {
			return err
		}
		return writeJSON(appprotocol.LiveActionsResponse{Draft: draft})
	})
}

func withLiveActionDraft(store *db.DB, meeting appprotocol.MeetingDetail) (appprotocol.MeetingDetail, error) {
	draft, err := (liveactions.Module{Store: store}).Read(cmdContext(), meeting.ID)
	meeting.LiveActionDraft = draft
	return meeting, err
}
