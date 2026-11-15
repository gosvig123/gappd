package main

import (
	"fmt"
	"os/signal"
	"slices"
	"syscall"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

func appPersonFactsCmd() *cobra.Command {
	cmd := meetingJSONCommand("person-facts [meeting-id]", cobra.ExactArgs(1), func(args []string) error {
		return runPersonFacts(args[0])
	})
	cmd.SilenceUsage, cmd.SilenceErrors = true, true
	return cmd
}

// runPersonFacts extracts facts about the other speakers of one Meeting with the notes provider.
func runPersonFacts(meetingID string) error {
	ctx, stop := signal.NotifyContext(cmdContext(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	cfg, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	meeting, err := store.GetMeeting(meetingID)
	if err != nil {
		return fmt.Errorf("extract person facts: %w", err)
	}
	segments, err := store.GetSegments(meetingID)
	if err != nil {
		return fmt.Errorf("extract person facts of meeting %s: %w", meetingID, err)
	}
	speakers, people := otherSpeakers(segments)
	if len(speakers) == 0 {
		return writeJSON(appprotocol.PersonFactsResponse{Facts: []appprotocol.PersonFact{}})
	}
	provider, err := newAIProvider(cfg.AI)
	if err != nil {
		return fmt.Errorf("extract person facts: %w; choose a notes provider in Settings", err)
	}
	if err := provider.Available(); err != nil {
		return fmt.Errorf("extract person facts: notes provider is not ready: %w", err)
	}
	facts, err := ai.ExtractPersonFacts(ctx, provider, db.FormatLabeledTranscript(segments), speakers, meeting.Language)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.PersonFactsResponse{Facts: appprotocol.BuildPersonFacts(facts, people)})
}

// otherSpeakers lists the speaker labels of a Meeting except the user's own ("You"), with the
// name of the Person labeled on each.
func otherSpeakers(segments []db.Segment) ([]string, map[string]string) {
	var speakers []string
	people := map[string]string{}
	for _, segment := range segments {
		key := segment.SpeakerKey
		if key == "" {
			key = segment.Speaker
		}
		if key == "" || key == db.SpeakerYou || slices.Contains(speakers, key) {
			continue
		}
		speakers = append(speakers, key)
		if segment.Speaker != key {
			people[key] = segment.Speaker
		}
	}
	return speakers, people
}
