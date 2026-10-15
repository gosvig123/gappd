package main

import (
	"fmt"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

func appPeopleCmd() *cobra.Command {
	return meetingJSONCommand("people", nil, func(_ []string) error {
		return changePeople(func(*db.DB) error { return nil })
	})
}

func appUpdatePersonCmd() *cobra.Command {
	var person db.Person
	cmd := meetingJSONCommand("update-person [person-id]", cobra.ExactArgs(1), func(args []string) error {
		person.ID = args[0]
		return changePeople(func(store *db.DB) error { return store.UpdatePerson(person) })
	})
	cmd.SilenceUsage, cmd.SilenceErrors = true, true
	cmd.Flags().StringVar(&person.Name, "name", "", "Person name")
	cmd.Flags().StringVar(&person.Email, "email", "", "Person email; empty removes it")
	return cmd
}

func appMergePeopleCmd() *cobra.Command {
	var kept db.Person
	var mergeID string
	cmd := meetingJSONCommand("merge-people [keep-person-id]", cobra.ExactArgs(1), func(args []string) error {
		kept.ID = args[0]
		return changePeople(func(store *db.DB) error { return store.MergePeople(kept, mergeID) })
	})
	cmd.SilenceUsage, cmd.SilenceErrors = true, true
	cmd.Flags().StringVar(&mergeID, "merge-id", "", "Person ID to merge into the kept Person")
	cmd.Flags().StringVar(&kept.Name, "name", "", "Name of the merged Person")
	cmd.Flags().StringVar(&kept.Email, "email", "", "Email of the merged Person; empty removes it")
	return cmd
}

// changePeople applies one change and returns the updated People list.
func changePeople(change func(*db.DB) error) error {
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := change(store); err != nil {
		return err
	}
	people, err := store.ListPeople()
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.PeopleResponse{People: appprotocol.BuildPeople(people)})
}

func appAssignSpeakerCmd() *cobra.Command {
	var key string
	var person db.Person
	cmd := meetingJSONCommand("assign-speaker [meeting-id]", cobra.ExactArgs(1), func(args []string) error {
		return runAssignSpeaker(args[0], key, person)
	})
	cmd.Flags().StringVar(&key, "speaker-key", "", "Original speaker key")
	cmd.Flags().StringVar(&person.ID, "person-id", "", "Saved person ID")
	cmd.Flags().StringVar(&person.Name, "name", "", "Person name")
	cmd.Flags().StringVar(&person.Email, "email", "", "Person email")
	return cmd
}

func runAssignSpeaker(id, key string, person db.Person) error {
	_, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.AssignSpeaker(id, key, person); err != nil {
		return err
	}
	return writeAppMeeting(store, id)
}

func meetingJSONCommand(use string, args cobra.PositionalArgs, run func([]string) error) *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{Use: use, Args: args, RunE: func(cmd *cobra.Command, args []string) error {
		if !asJSON {
			return fmt.Errorf("%s requires --json", cmd.CommandPath())
		}
		return run(args)
	}}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func writeAppMeeting(store *db.DB, id string) error {
	detail, err := appMeetingDetailFor(store, id)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.MeetingResponse{Meeting: detail})
}
