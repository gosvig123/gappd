package main

import (
	"fmt"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/audioartifact"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

func appMeetingsDeleteCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "delete [meeting-id]",
		Short: "Delete a saved meeting as JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAppMeetingsDelete(args[0], asJSON)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func runAppMeetingsDelete(id string, asJSON bool) error {
	if !asJSON {
		return fmt.Errorf("app meetings delete requires --json")
	}
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	response, err := appDeleteMeeting(store, id)
	if err != nil {
		return err
	}
	return writeJSON(response)
}

func appDeleteMeeting(store *db.DB, id string) (appprotocol.MeetingDeleteResponse, error) {
	meeting, err := store.DeleteMeeting(id)
	if err != nil {
		return appprotocol.MeetingDeleteResponse{}, err
	}
	return appprotocol.MeetingDeleteResponse{DeletedID: meeting.ID, ArtifactWarning: removeMeetingArtifacts(meeting.AudioPath)}, nil
}

func removeMeetingArtifacts(sessionDir *string) *string {
	if sessionDir == nil || *sessionDir == "" {
		return nil
	}
	if err := audioartifact.DeleteSession(*sessionDir); err != nil {
		message := err.Error()
		return &message
	}
	return nil
}
