package main

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/spf13/cobra"
)

const (
	meetingLanguageBusyMessage    = "change the language after this Meeting finishes recording and processing"
	meetingLanguageNoAudioMessage = "this Meeting has no complete saved audio, so it cannot be transcribed in another language"
)

// appMeetingsSetLanguageCmd changes a Meeting's language and queues its transcript, speaker labels and notes again.
func appMeetingsSetLanguageCmd() *cobra.Command {
	var asJSON bool
	var language string
	cmd := &cobra.Command{Use: "set-language [meeting-id]", Short: "Transcribe a saved Meeting again in another language", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		cmd.Root().SilenceUsage = true
		if !asJSON {
			return fmt.Errorf("app meetings set-language requires --json")
		}
		if !meetinglang.Supported(language) {
			return fmt.Errorf("gappd does not support the language %q; choose one from the language list", language)
		}
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		if err := setMeetingLanguage(store, args[0], language); err != nil {
			return err
		}
		return writeAppMeeting(store, args[0])
	}}
	cmd.Flags().StringVar(&language, "language", "", "Apple Speech locale, for example de_DE")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func setMeetingLanguage(store *db.DB, id, language string) error {
	result, err := meetinglifecycle.New(store).ChangeLanguage(cmdContext(), id, language, time.Now())
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("meeting %s was not found; reopen the Meeting list", id)
	}
	if err != nil || result.Applied {
		return err
	}
	meeting := result.Meeting
	switch {
	case meeting == nil:
		return fmt.Errorf("meeting %s was not found; reopen the Meeting list", id)
	case meetinglang.Normalize(meeting.Language) == language:
		return nil
	case meeting.CaptureStatus == db.CaptureStatusRecording || meeting.ProcessingStatus == db.ProcessingStatusProcessing:
		return errors.New(meetingLanguageBusyMessage)
	default:
		return errors.New(meetingLanguageNoAudioMessage)
	}
}
