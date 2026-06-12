package main

import (
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/recording"
)

const (
	meetingMarkerCaptured   = "○"
	meetingMarkerCompleted  = "●"
	meetingMarkerFailed     = "!"
	meetingMarkerProcessing = "..."
	meetingIDPreviewLength  = 8
	meetingDateLength       = 10
)

type meetingListView struct {
	ID            string           `json:"id"`
	Title         string           `json:"title"`
	StartedAt     string           `json:"startedAt"`
	EndedAt       *string          `json:"endedAt,omitempty"`
	Status        appMeetingStatus `json:"status"`
	HasTranscript bool             `json:"hasTranscript"`
	HasSummary    bool             `json:"hasSummary"`
	shortID       string
	date          string
	capture       db.CaptureStatus
	processing    db.ProcessingStatus
}

type meetingDetailView struct {
	ID                       string               `json:"id"`
	Title                    string               `json:"title"`
	StartedAt                string               `json:"startedAt"`
	EndedAt                  *string              `json:"endedAt,omitempty"`
	Status                   appMeetingStatus     `json:"status"`
	TranscriptText           string               `json:"transcriptText,omitempty"`
	Summary                  string               `json:"summary,omitempty"`
	Segments                 []meetingSegmentView `json:"segments"`
	capture                  db.CaptureStatus
	processing               db.ProcessingStatus
	captureFailureMessage    *string
	processingFailureMessage *string
}

type meetingSegmentView struct {
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
	Speaker  string  `json:"speaker"`
	Text     string  `json:"text"`
}

func buildMeetingListViews(meetings []db.Meeting) []meetingListView {
	views := make([]meetingListView, 0, len(meetings))
	for _, meeting := range meetings {
		views = append(views, buildMeetingListView(meeting))
	}
	return views
}

func buildMeetingListView(meeting db.Meeting) meetingListView {
	return meetingListView{
		ID:            meeting.ID,
		Title:         meeting.Title,
		StartedAt:     meeting.StartedAt,
		EndedAt:       meeting.EndedAt,
		Status:        appMeetingStatusFor(meeting),
		HasTranscript: meeting.Transcript != nil,
		HasSummary:    meeting.Summary != nil,
		shortID:       previewID(meeting.ID),
		date:          meetingDate(meeting.StartedAt),
		capture:       meeting.CaptureStatus,
		processing:    meeting.ProcessingStatus,
	}
}

func buildMeetingDetailView(store *db.DB, id string) (meetingDetailView, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return meetingDetailView{}, err
	}
	segments, err := store.GetSegments(id)
	if err != nil {
		return meetingDetailView{}, err
	}
	return buildMeetingDetail(*meeting, segments), nil
}

func buildMeetingDetail(meeting db.Meeting, segments []db.Segment) meetingDetailView {
	return meetingDetailView{
		ID:                       meeting.ID,
		Title:                    meeting.Title,
		StartedAt:                meeting.StartedAt,
		EndedAt:                  meeting.EndedAt,
		Status:                   appMeetingStatusFor(meeting),
		TranscriptText:           transcriptText(meeting, segments),
		Summary:                  stringValue(meeting.Summary),
		Segments:                 buildSegmentViews(segments),
		capture:                  meeting.CaptureStatus,
		processing:               meeting.ProcessingStatus,
		captureFailureMessage:    meeting.CaptureFailureMessage,
		processingFailureMessage: meeting.ProcessingFailureMessage,
	}
}

func transcriptText(meeting db.Meeting, segments []db.Segment) string {
	if meeting.Transcript != nil {
		return *meeting.Transcript
	}
	if len(segments) == 0 {
		return ""
	}
	return recording.FormatTranscript(segments)
}

func buildSegmentViews(segments []db.Segment) []meetingSegmentView {
	views := make([]meetingSegmentView, 0, len(segments))
	for _, segment := range segments {
		views = append(views, meetingSegmentView{StartSec: segment.Start, EndSec: segment.End, Speaker: segment.Speaker, Text: segment.Text})
	}
	return views
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

func renderMeetingListLine(view meetingListView) string {
	return fmt.Sprintf("  %s %s  %s  %s (capture: %s, processing: %s)", meetingMarker(view.Status.State), view.shortID, view.date, view.Title, view.capture, view.processing)
}

func renderMeetingDetail(view meetingDetailView) string {
	var b strings.Builder
	writeMeetingHeader(&b, view)
	writeMeetingTranscript(&b, view)
	writeMeetingSummary(&b, view)
	return b.String()
}

func writeMeetingHeader(b *strings.Builder, view meetingDetailView) {
	fmt.Fprintf(b, "# %s\nDate: %s\n", view.Title, view.StartedAt)
	writeOptionalLine(b, "Ended", view.EndedAt)
	fmt.Fprintf(b, "Capture: %s\n", view.capture)
	writeOptionalLine(b, "Capture failure", view.captureFailureMessage)
	fmt.Fprintf(b, "Processing: %s\n", view.processing)
	writeOptionalLine(b, "Processing failure", view.processingFailureMessage)
}

func writeMeetingTranscript(b *strings.Builder, view meetingDetailView) {
	if view.TranscriptText == "" {
		return
	}
	fmt.Fprintf(b, "\n── Transcript ──────────────────────\n%s\n", view.TranscriptText)
}

func writeMeetingSummary(b *strings.Builder, view meetingDetailView) {
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
