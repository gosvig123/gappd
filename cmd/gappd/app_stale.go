package main

import (
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/spf13/cobra"
)

func appRecordHasStaleCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "has-stale",
		Short: "Check for stale desktop recordings",
		RunE:  func(cmd *cobra.Command, args []string) error { return runAppHasStale(asJSON) },
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func runAppHasStale(asJSON bool) error {
	if !asJSON {
		return fmt.Errorf("app record has-stale requires --json")
	}
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	cutoff := time.Now().UTC().Add(-meetingprocessing.StaleRecordingTimeout).Format(time.RFC3339)
	meetings, err := store.ListStaleRecordingMeetings(cutoff, 1)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.HasStaleRecordingsResponse{HasStale: len(meetings) > 0})
}
