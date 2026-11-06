package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/audioartifact"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
	"github.com/gappd-dev/gappd/internal/meetinglifecycle"
	"github.com/spf13/cobra"
)

const (
	meetingLanguageBusyMessage    = "this Meeting is still recording or processing; try again when it finishes"
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
		language = strings.TrimSpace(language)
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

// setMeetingLanguage checks the audio files before it clears the transcript: without audio the
// Meeting would lose its transcript and end failed. The SQL guards still cover a race with the queue.
func setMeetingLanguage(store *db.DB, id, language string) error {
	meeting, err := store.GetMeeting(id)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("meeting %s was not found; reopen the Meeting list", id)
	}
	if err != nil {
		return err
	}
	if meetinglang.Normalize(meeting.Language) == language {
		return nil
	}
	if meeting.CaptureStatus == db.CaptureStatusRecording || meeting.ProcessingStatus == db.ProcessingStatusProcessing {
		return errors.New(meetingLanguageBusyMessage)
	}
	if !hasSavedAudio(meeting) {
		return errors.New(meetingLanguageNoAudioMessage)
	}
	result, err := meetinglifecycle.New(store).ChangeLanguage(cmdContext(), id, language, time.Now())
	if err != nil || result.Applied {
		return err
	}
	if result.Meeting != nil && meetinglang.Normalize(result.Meeting.Language) == language {
		return nil
	}
	// The Meeting started recording or processing between the check and the change.
	return errors.New(meetingLanguageBusyMessage)
}

func hasSavedAudio(meeting *db.Meeting) bool {
	if meeting.CaptureStatus == db.CaptureStatusFailed || meeting.AudioPath == nil || strings.TrimSpace(*meeting.AudioPath) == "" {
		return false
	}
	return audioartifact.New(*meeting.AudioPath).HasAudio()
}
