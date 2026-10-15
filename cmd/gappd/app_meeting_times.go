package main

import "github.com/gappd-dev/gappd/internal/appprotocol"
import "github.com/spf13/cobra"

func appMeetingTimesCmd() *cobra.Command {
	return meetingJSONCommand("times", nil, func(_ []string) error {
		_, store, err := loadStore()
		if err != nil {
			return err
		}
		defer store.Close()
		times, err := store.MeetingTimes()
		if err != nil {
			return err
		}
		meetings := make([]appprotocol.MeetingTime, 0, len(times))
		for _, entry := range times {
			meetings = append(meetings, appprotocol.MeetingTime{StartedAt: entry.StartedAt, EndedAt: entry.EndedAt})
		}
		return writeJSON(appprotocol.MeetingTimesResponse{Meetings: meetings})
	})
}
