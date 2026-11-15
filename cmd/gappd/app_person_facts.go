package main

import (
	"context"
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
	cmd := meetingJSONCommand("person-facts [person-id]", cobra.ExactArgs(1), func(args []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		return writePersonFacts(store, args[0])
	})
	cmd.SilenceUsage, cmd.SilenceErrors = true, true
	return cmd
}

func appHidePersonFactCmd() *cobra.Command {
	var fact int64
	var hidden bool
	cmd := meetingJSONCommand("hide-person-fact [person-id]", cobra.ExactArgs(1), func(args []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		if err := store.SetPersonFactHidden(args[0], fact, hidden); err != nil {
			return err
		}
		return writePersonFacts(store, args[0])
	})
	cmd.SilenceUsage, cmd.SilenceErrors = true, true
	cmd.Flags().Int64Var(&fact, "fact", 0, "Fact ID")
	cmd.Flags().BoolVar(&hidden, "hidden", false, "Hide the fact; false shows it again")
	return cmd
}

func writePersonFacts(store *db.DB, personID string) error {
	name, err := personName(store, personID)
	if err != nil {
		return err
	}
	facts, err := store.PersonFacts(personID)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.PersonFactsResponse{Facts: appprotocol.BuildPersonFacts(name, facts)})
}

func appExtractPersonFactsCmd() *cobra.Command {
	var meetingID string
	var count bool
	cmd := meetingJSONCommand("extract-person-facts", nil, func(_ []string) error {
		return runExtractPersonFacts(meetingID, count)
	})
	cmd.SilenceUsage, cmd.SilenceErrors = true, true
	cmd.Flags().StringVar(&meetingID, "meeting", "", "Read only this Meeting, also when it was read before")
	cmd.Flags().BoolVar(&count, "count", false, "Only count the Meetings that need Person facts")
	return cmd
}

func personName(store *db.DB, personID string) (string, error) {
	people, err := store.ListPeople()
	if err != nil {
		return "", fmt.Errorf("list facts of person %s: %w", personID, err)
	}
	for _, person := range people {
		if person.ID == personID {
			return person.Name, nil
		}
	}
	return "", fmt.Errorf("list facts: person %s not found; reload People", personID)
}

// runExtractPersonFacts reads Person facts from each Meeting that needs them, with the notes
// provider. A failed Meeting is saved as failed and the run goes on.
func runExtractPersonFacts(meetingID string, count bool) error {
	ctx, stop := signal.NotifyContext(cmdContext(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	cfg, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	targets, err := personFactTargets(store, meetingID)
	if err != nil {
		return err
	}
	result := appprotocol.ExtractPersonFactsResponse{Pending: len(targets)}
	if count || len(targets) == 0 {
		return writeJSON(result)
	}
	provider, err := newAIProvider(cfg.AI)
	if err != nil {
		return fmt.Errorf("extract person facts: %w; choose a notes provider in Settings", err)
	}
	if err := provider.Available(); err != nil {
		return fmt.Errorf("extract person facts: notes provider is not ready: %w", err)
	}
	for _, target := range targets {
		err := extractMeetingFacts(ctx, store, provider, target)
		if ctx.Err() != nil {
			return fmt.Errorf("extract person facts: stopped: %w", ctx.Err())
		}
		if err != nil {
			result.Failed++
			result.Pending--
			if saveErr := store.SavePersonFactsFailure(ctx, target.MeetingID, target.TranscriptRevision, err); saveErr != nil {
				return saveErr
			}
			continue
		}
		result.Completed++
		result.Pending--
	}
	return writeJSON(result)
}

func personFactTargets(store *db.DB, meetingID string) ([]db.PersonFactTarget, error) {
	if meetingID == "" {
		return store.PersonFactTargets()
	}
	meeting, err := store.GetMeeting(meetingID)
	if err != nil {
		return nil, fmt.Errorf("extract person facts: %w", err)
	}
	return []db.PersonFactTarget{{MeetingID: meeting.ID, TranscriptRevision: meeting.TranscriptRevision, Language: meeting.Language}}, nil
}

func extractMeetingFacts(ctx context.Context, store *db.DB, provider ai.Provider, target db.PersonFactTarget) error {
	segments, err := store.GetSegments(target.MeetingID)
	if err != nil {
		return fmt.Errorf("extract person facts of meeting %s: %w", target.MeetingID, err)
	}
	facts, err := ai.ExtractPersonFacts(ctx, provider, db.FormatLabeledTranscript(segments), otherSpeakers(segments), target.Language)
	if err != nil {
		return err
	}
	saved := make([]db.NewPersonFact, 0, len(facts))
	for _, fact := range facts {
		quotes := make([]string, 0, len(fact.Evidence))
		for _, quote := range fact.Evidence {
			quotes = append(quotes, quote.Text)
		}
		saved = append(saved, db.NewPersonFact{SpeakerKey: fact.Speaker, Kind: fact.Kind, Text: fact.Text, Quotes: quotes})
	}
	// A transcript changed during the read is read again in the next pass.
	_, err = store.SavePersonFacts(ctx, target.MeetingID, target.TranscriptRevision, saved)
	return err
}

// otherSpeakers lists the speaker labels of a Meeting except the user's own ("You").
func otherSpeakers(segments []db.Segment) []string {
	var speakers []string
	for _, segment := range segments {
		key := segment.SpeakerKey
		if key == "" {
			key = segment.Speaker
		}
		if key != "" && key != db.SpeakerYou && !slices.Contains(speakers, key) {
			speakers = append(speakers, key)
		}
	}
	return speakers
}
