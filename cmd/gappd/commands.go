package main

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/spf13/cobra"
)

func enhanceCmd() *cobra.Command {
	var notes string
	var feedback string
	var refine bool
	cmd := &cobra.Command{
		Use:     "enhance [meeting-id]",
		Aliases: []string{"summarize"},
		Short:   "Run AI extraction and synthesis on a meeting transcript",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, store, pipeline, err := loadDeps()
			if err != nil {
				return err
			}
			defer store.Close()
			service := newMeetingProcessingService(store, pipeline, recordingOutputConsole)
			return service.EnhanceStored(cmdContext(), meetingprocessing.StoredRequest{MeetingID: args[0], Notes: notes, Feedback: feedback, Refine: refine})
		},
	}
	cmd.Flags().StringVarP(&notes, "notes", "n", "", "Your rough notes")
	cmd.Flags().StringVarP(&feedback, "feedback", "f", "", "Feedback for improving existing notes")
	cmd.Flags().BoolVar(&refine, "refine", false, "Run a second pass over generated notes")
	return cmd
}

func meetingsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "meetings",
		Short: "List recorded meetings",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, store, _, err := loadDeps()
			if err != nil {
				return err
			}
			defer store.Close()
			return listMeetings(store)
		},
	}
}

func listMeetings(store *db.DB) error {
	meetings, err := store.ListMeetings(20)
	if err != nil {
		return err
	}
	if len(meetings) == 0 {
		fmt.Println("No meetings yet. Run `gappd listen` to record one.")
		return nil
	}
	for _, meeting := range meetings {
		fmt.Println(renderMeetingListLine(meeting))
	}
	return nil
}

func showCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show [meeting-id]",
		Short: "Display transcript and summary for a meeting",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, store, _, err := loadDeps()
			if err != nil {
				return err
			}
			defer store.Close()
			return showMeeting(store, args[0])
		},
	}
}

func showMeeting(store *db.DB, id string) error {
	meeting, segments, err := loadMeetingDetail(store, id)
	if err != nil {
		return err
	}
	fmt.Print(renderMeetingDetail(*meeting, appprotocol.BuildMeetingDetail(*meeting, segments)))
	return nil
}
