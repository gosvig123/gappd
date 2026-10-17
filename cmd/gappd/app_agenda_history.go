package main

import "github.com/gappd-dev/gappd/internal/appprotocol"
import "github.com/spf13/cobra"

func appAgendaHistoryCmd() *cobra.Command {
	return meetingJSONCommand("agenda-history", nil, func(_ []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		history, err := store.AgendaHistory()
		if err != nil {
			return err
		}
		meetings := make([]appprotocol.AgendaHistoryMeeting, 0, len(history))
		for _, meeting := range history {
			meetings = append(meetings, appprotocol.AgendaHistoryMeeting{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Emails: meeting.Emails})
		}
		return writeJSON(appprotocol.AgendaHistoryResponse{Meetings: meetings})
	})
}
