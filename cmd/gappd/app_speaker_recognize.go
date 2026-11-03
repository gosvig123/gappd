package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

func appRecognizeSpeakersCmd() *cobra.Command {
	var revision int
	var emails string
	var calendar bool
	cmd := meetingJSONCommand("recognize-speakers [meeting-id]", cobra.ExactArgs(1), func(args []string) error {
		if len(emails) > 25400 {
			return fmt.Errorf("recognize speakers: invitee list exceeds limit")
		}
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		// A stale target is skipped, not failed: the change that moved it asks for recognition again.
		if err := store.RecognizeSpeakers(args[0], revision, strings.Split(emails, ","), calendar); err != nil && !errors.Is(err, db.ErrRecognitionStale) {
			return err
		}
		return writeAppMeeting(store, args[0])
	})
	cmd.Flags().IntVar(&revision, "revision", -1, "Expected transcript revision")
	cmd.Flags().StringVar(&emails, "emails", "", "Confirmed Calendar invitee emails")
	cmd.Flags().BoolVar(&calendar, "calendar", false, "Constrain candidates to confirmed Calendar snapshot")
	return cmd
}

func appVoiceTargetsCmd() *cobra.Command {
	var after string
	cmd := meetingJSONCommand("voice-targets", nil, func(_ []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		targets, err := store.VoiceTargets(after)
		if err != nil {
			return err
		}
		return writeJSON(appprotocol.VoiceTargetsResponse{Targets: appprotocol.BuildVoiceTargets(targets)})
	})
	cmd.Flags().StringVar(&after, "after", "", "Last Meeting ID from previous page")
	return cmd
}
