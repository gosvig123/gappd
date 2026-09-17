package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

const maxAgendaSourceBytes = ai.MaxAgendaHistoryBytes
const maxAgendaSources = 12

func appAgendaCmd() *cobra.Command {
	var input appprotocol.AgendaInput
	cmd := meetingJSONCommand("agenda", nil, func(_ []string) error { return runAgenda(input) })
	cmd.SilenceUsage = true
	cmd.SilenceErrors = true
	cmd.Flags().StringVar(&input.Title, "title", "", "Upcoming event title")
	cmd.Flags().StringVar(&input.MeetingIDs, "meeting-ids", "", "Matched local Meeting IDs")
	return cmd
}

func runAgenda(input appprotocol.AgendaInput) error {
	cfg, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	sources, err := agendaSources(store, strings.Split(input.MeetingIDs, ","))
	if err != nil {
		return err
	}
	return completeAgenda(cfg.AI, input.Title, sources)
}

func completeAgenda(settings config.AI, title string, sources []ai.AgendaSource) error {
	provider, err := newAIProvider(settings)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	draft, err := ai.GenerateAgenda(ctx, provider, title, sources)
	if err != nil {
		var capacity *ai.AgendaCapacityError
		if errors.As(err, &capacity) {
			return fmt.Errorf("generate agenda: %w", err)
		}
		return fmt.Errorf("generate agenda: %w; check your AI model in Settings or retry", err)
	}
	return writeJSON(appprotocol.BuildAgenda(draft, agendaGenerationFor(provider, settings)))
}

func agendaGenerationFor(provider ai.Provider, settings config.AI) appprotocol.AgendaGeneration {
	generation := providerGenerationFor(provider, settings)
	return appprotocol.AgendaGeneration{Model: generation.Model, ReasoningEffort: generation.Effort}
}

func agendaSources(store *db.DB, ids []string) ([]ai.AgendaSource, error) {
	if len(ids) == 0 || len(ids) > maxAgendaSources {
		return nil, fmt.Errorf("agenda: expected 1–12 source Meetings")
	}
	sources := make([]ai.AgendaSource, 0, len(ids))
	total := 0
	for _, id := range ids {
		source, err := agendaSource(store, id)
		if err != nil {
			return nil, err
		}
		text := source.Text
		total += len(text)
		if total > maxAgendaSourceBytes {
			return nil, fmt.Errorf("agenda: matched transcripts exceed the 576000-byte processing input limit; prepare this agenda manually from matched Meetings; no draft was generated")
		}
		sources = append(sources, source)
	}
	return sources, nil
}

func agendaSource(store *db.DB, id string) (ai.AgendaSource, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return ai.AgendaSource{}, err
	}
	if meeting.Transcript == nil || strings.TrimSpace(*meeting.Transcript) == "" || meeting.CaptureStatus != db.CaptureStatusCaptured {
		return ai.AgendaSource{}, fmt.Errorf("agenda: source Meeting has no finished transcript")
	}
	return ai.AgendaSource{ID: id, Title: meeting.Title, StartedAt: meeting.StartedAt, Text: *meeting.Transcript}, nil
}
