package selectedfixture

import (
	"fmt"
	"time"

	"github.com/gappd-dev/gappd/internal/db"
)

// ReviewMeetings are fictional Meetings that give UI reviews a realistic list: several days,
// varied lengths, and one failed and one transcript-only state. Export still accepts only ID.
func ReviewMeetings(now time.Time) []*db.Meeting {
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	type entry struct {
		title          string
		daysAgo        int
		hour, minute   int
		minutes        int
		failed, noNote bool
	}
	entries := []entry{
		{title: "Onboarding flow walkthrough with design", daysAgo: 1, hour: 16, minute: 30, minutes: 31},
		{title: "Partner pricing and contract terms", daysAgo: 2, hour: 18, minutes: 64},
		{title: "Import controls and release plan", daysAgo: 2, hour: 16, minute: 18, minutes: 21, noNote: true},
		{title: "Weekly product sync", daysAgo: 2, hour: 14, minute: 59, minutes: 51},
		{title: "Customer interview: field operations lead", daysAgo: 4, hour: 11, minutes: 42, failed: true},
		{title: "Hiring loop debrief", daysAgo: 6, hour: 9, minute: 30, minutes: 25},
	}
	meetings := make([]*db.Meeting, 0, len(entries))
	for i, e := range entries {
		start := day.AddDate(0, 0, -e.daysAgo).Add(time.Duration(e.hour)*time.Hour + time.Duration(e.minute)*time.Minute)
		started, ended := start.UTC().Format(time.RFC3339), start.Add(time.Duration(e.minutes)*time.Minute).UTC().Format(time.RFC3339)
		m := &db.Meeting{ID: fmt.Sprintf("5e1ec7ed-0000-4000-8000-%012d", i+1), Title: e.title, StartedAt: started, EndedAt: &ended,
			CaptureStatus: db.CaptureStatusCaptured, CaptureStatusUpdatedAt: ended, ProcessingStatus: db.ProcessingStatusCompleted,
			ProcessingStatusUpdatedAt: ended, Source: "synthetic"}
		if e.failed {
			m.ProcessingStatus = db.ProcessingStatusFailed
			m.ProcessingFailureMessage = pointer("Transcription failed: the audio file could not be read.")
		} else {
			m.Transcript, m.TranscriptRevision = pointer("[00:00] Fictional speaker: Fictional notes for "+e.title+"."), 1
			if !e.noNote {
				m.Summary, m.SummaryTranscriptRevision = pointer("Fictional summary for "+e.title+"."), 1
			}
		}
		meetings = append(meetings, m)
	}
	return meetings
}
