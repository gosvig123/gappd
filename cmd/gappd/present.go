package main

import (
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/db"
)

const (
	meetingMarkerCaptured   = "○"
	meetingMarkerCompleted  = "●"
	meetingMarkerFailed     = "!"
	meetingMarkerProcessing = "..."
	meetingIDPreviewLength  = 8
	meetingDateLength       = 10
)

func renderMeetingListLine(meeting db.Meeting) string {
	return fmt.Sprintf("  %s %s  %s  %s (capture: %s, processing: %s)", meetingMarker(db.MeetingStateFor(meeting)), previewID(meeting.ID), meetingDate(meeting.StartedAt), meeting.Title, meeting.CaptureStatus, meeting.ProcessingStatus)
}

func renderMeetingDetail(meeting db.Meeting, view appprotocol.MeetingDetail) string {
	var b strings.Builder
	writeMeetingHeader(&b, meeting, view)
	writeMeetingTranscript(&b, view)
	writeMeetingSummary(&b, view)
	return b.String()
}

func writeMeetingHeader(b *strings.Builder, meeting db.Meeting, view appprotocol.MeetingDetail) {
	fmt.Fprintf(b, "# %s\nDate: %s\n", view.Title, view.StartedAt)
	writeOptionalLine(b, "Ended", view.EndedAt)
	fmt.Fprintf(b, "Capture: %s\n", meeting.CaptureStatus)
	writeOptionalLine(b, "Capture failure", meeting.CaptureFailureMessage)
	fmt.Fprintf(b, "Processing: %s\n", meeting.ProcessingStatus)
	writeOptionalLine(b, "Processing failure", meeting.ProcessingFailureMessage)
}

func writeMeetingTranscript(b *strings.Builder, view appprotocol.MeetingDetail) {
	if view.TranscriptText == "" {
		return
	}
	fmt.Fprintf(b, "\n── Transcript ──────────────────────\n%s\n", view.TranscriptText)
}

func writeMeetingSummary(b *strings.Builder, view appprotocol.MeetingDetail) {
	if view.Summary == "" {
		fmt.Fprintf(b, "\nNo notes yet. Run `gappd enhance %s`\n", view.ID)
		return
	}
	fmt.Fprintf(b, "── Notes ───────────────────────────\n%s\n", view.Summary)
}

func meetingMarker(status db.MeetingState) string {
	switch status {
	case db.MeetingStateCompleted:
		return meetingMarkerCompleted
	case db.MeetingStateFailed:
		return meetingMarkerFailed
	case db.MeetingStateProcessing:
		return meetingMarkerProcessing
	default:
		return meetingMarkerCaptured
	}
}

func writeOptionalLine(b *strings.Builder, label string, value *string) {
	if value != nil {
		fmt.Fprintf(b, "%s: %s\n", label, *value)
	}
}

func meetingDate(startedAt string) string {
	if len(startedAt) < meetingDateLength {
		return startedAt
	}
	return startedAt[:meetingDateLength]
}

func previewID(id string) string {
	if len(id) < meetingIDPreviewLength {
		return id
	}
	return id[:meetingIDPreviewLength]
}
