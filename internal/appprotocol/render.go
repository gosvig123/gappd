package appprotocol

import (
	"fmt"
	"strings"
)

func writeMeetingHeader(b *strings.Builder, view MeetingDetail) {
	fmt.Fprintf(b, "# %s\nDate: %s\n", view.Title, view.StartedAt)
	writeOptionalLine(b, "Ended", view.EndedAt)
	fmt.Fprintf(b, "Capture: %s\n", view.capture)
	writeOptionalLine(b, "Capture failure", view.captureFailureMessage)
	fmt.Fprintf(b, "Processing: %s\n", view.processing)
	writeOptionalLine(b, "Processing failure", view.processingFailureMessage)
}

func writeMeetingTranscript(b *strings.Builder, view MeetingDetail) {
	if view.TranscriptText == "" {
		return
	}
	fmt.Fprintf(b, "\n── Transcript ──────────────────────\n%s\n", view.TranscriptText)
}

func writeMeetingSummary(b *strings.Builder, view MeetingDetail) {
	if view.Summary == "" {
		fmt.Fprintf(b, "\nNo notes yet. Run `gappd enhance %s`\n", view.ID)
		return
	}
	fmt.Fprintf(b, "── Notes ───────────────────────────\n%s\n", view.Summary)
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

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
