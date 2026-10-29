package main

import (
	"encoding/json"
	"fmt"
	"os/signal"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/agenda"
	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/spf13/cobra"
)

// agendaLookback must match AGENDA_LOOKBACK_DAYS in desktop/src/shared/agenda.ts.
const agendaLookback = 180 * 24 * time.Hour

func appAgendaCmd() *cobra.Command {
	var eventJSON, linkedJSON string
	cmd := meetingJSONCommand("agenda", nil, func(_ []string) error {
		return runAgenda(eventJSON, linkedJSON)
	})
	cmd.Flags().StringVar(&eventJSON, "event", "", `Upcoming event as JSON {"start","series","emails","self"}`)
	cmd.Flags().StringVar(&linkedJSON, "linked", "", `Past Meetings' linked events as a JSON array of {"id","series","emails"}`)
	return cmd
}

func runAgenda(eventJSON, linkedJSON string) error {
	ctx, stop := signal.NotifyContext(cmdContext(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	var event agenda.Event
	if err := json.Unmarshal([]byte(eventJSON), &event); err != nil {
		return fmt.Errorf("draft agenda: read event JSON: %w", err)
	}
	start, err := time.Parse(time.RFC3339, event.Start)
	if err != nil {
		return fmt.Errorf("draft agenda: event start %q is not an RFC 3339 time: %w", event.Start, err)
	}
	var linked []agenda.LinkedMeeting
	if linkedJSON != "" {
		if err := json.Unmarshal([]byte(linkedJSON), &linked); err != nil {
			return fmt.Errorf("draft agenda: read linked events JSON: %w", err)
		}
	}
	cfg, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	start = start.UTC()
	meetings, err := store.NotedMeetings(start.Add(-agendaLookback).Format(time.RFC3339), start.Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("draft agenda: %w", err)
	}
	related := agenda.FindRelated(event, linked, meetings)
	documents := agenda.MeetingNotesDocuments(related)
	if len(documents) == 0 {
		return writeJSON(appprotocol.BuildAgenda(nil, nil))
	}
	provider, err := agendaProvider(cfg)
	if err != nil {
		return err
	}
	items, err := agenda.Draft(ctx, provider, documents, related[0].Meeting.Language)
	if err != nil {
		return err
	}
	return writeJSON(appprotocol.BuildAgenda(items, documents))
}

func agendaProvider(cfg config.Config) (ai.Provider, error) {
	provider, err := newAIProvider(cfg.AI)
	if err != nil {
		return nil, fmt.Errorf("draft agenda: %w; choose a notes provider in Settings", err)
	}
	if err := provider.Available(); err != nil {
		return nil, fmt.Errorf("draft agenda: notes provider is not ready: %w", err)
	}
	return provider, nil
}
