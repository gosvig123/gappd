package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/spf13/cobra"
)

func appEnrichCmd() *cobra.Command {
	var input appprotocol.EnrichInput
	cmd := meetingJSONCommand("enrich [meeting-id]", cobra.ExactArgs(1), func(args []string) error {
		input.ID = args[0]
		return runEnrich(input)
	})
	cmd.SilenceUsage = true
	cmd.SilenceErrors = true
	cmd.Flags().StringVar(&input.CommunicationInput, "communication-input", "", "Read communication evidence from stdin (-)")
	return cmd
}

// runEnrich adds Gmail and Slack context to a Meeting's existing action items. It never changes the Meeting.
func runEnrich(input appprotocol.EnrichInput) error {
	if input.CommunicationInput != "-" {
		return fmt.Errorf("enrich: communication input must be stdin (-)")
	}
	cfg, store, err := loadStore()
	if err != nil {
		return err
	}
	defer store.Close()
	meeting, err := store.GetMeeting(input.ID)
	if err != nil {
		return err
	}
	if meeting.Summary == nil || strings.TrimSpace(*meeting.Summary) == "" {
		return fmt.Errorf("enrich: this Meeting has no summary yet; wait for notes, then try again")
	}
	sources, err := readAgendaCommunication(os.Stdin)
	if err != nil {
		return err
	}
	if len(sources) == 0 {
		return fmt.Errorf("enrich: no Gmail or Slack messages were supplied")
	}
	provider, err := newAIProvider(cfg.AI)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	notes, trimmed, err := ai.EnrichActionItems(ctx, provider, *meeting.Summary, sources)
	if err != nil {
		var capacity *ai.AgendaCapacityError
		if errors.As(err, &capacity) || strings.HasPrefix(err.Error(), "enrich:") {
			return err
		}
		return fmt.Errorf("enrich meeting: %w; check your AI model in Settings or retry", err)
	}
	return writeJSON(appprotocol.BuildEnrichment(notes, trimmed, agendaGenerationFor(provider, cfg.AI)))
}
