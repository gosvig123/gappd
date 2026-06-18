package appprotocol

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

type MeetingListItem struct {
	ID            string        `json:"id"`
	Title         string        `json:"title"`
	StartedAt     string        `json:"startedAt"`
	EndedAt       *string       `json:"endedAt,omitempty"`
	Status        MeetingStatus `json:"status"`
	HasTranscript bool          `json:"hasTranscript"`
	HasSummary    bool          `json:"hasSummary"`
	shortID       string
	date          string
	capture       db.CaptureStatus
	processing    db.ProcessingStatus
}

type MeetingDetail struct {
	ID                       string           `json:"id"`
	Title                    string           `json:"title"`
	StartedAt                string           `json:"startedAt"`
	EndedAt                  *string          `json:"endedAt,omitempty"`
	Status                   MeetingStatus    `json:"status"`
	TranscriptText           string           `json:"transcriptText,omitempty"`
	Summary                  string           `json:"summary,omitempty"`
	Segments                 []MeetingSegment `json:"segments"`
	capture                  db.CaptureStatus
	processing               db.ProcessingStatus
	captureFailureMessage    *string
	processingFailureMessage *string
}

type MeetingSegment struct {
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
	Speaker  string  `json:"speaker"`
	Text     string  `json:"text"`
}

func BuildMeetingListViews(meetings []db.Meeting) []MeetingListItem {
	views := make([]MeetingListItem, 0, len(meetings))
	for _, meeting := range meetings {
		views = append(views, BuildMeetingListView(meeting))
	}
	return views
}

func BuildMeetingListView(meeting db.Meeting) MeetingListItem {
	return MeetingListItem{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: MeetingStatusFor(meeting), HasTranscript: meeting.Transcript != nil, HasSummary: meeting.Summary != nil, shortID: previewID(meeting.ID), date: meetingDate(meeting.StartedAt), capture: meeting.CaptureStatus, processing: meeting.ProcessingStatus}
}

func BuildMeetingDetailView(store *db.DB, id string) (MeetingDetail, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return MeetingDetail{}, err
	}
	segments, err := store.GetSegments(id)
	if err != nil {
		return MeetingDetail{}, err
	}
	return BuildMeetingDetail(*meeting, segments), nil
}

func BuildMeetingDetail(meeting db.Meeting, segments []db.Segment) MeetingDetail {
	return MeetingDetail{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: MeetingStatusFor(meeting), TranscriptText: transcriptText(meeting, segments), Summary: stringValue(meeting.Summary), Segments: buildSegmentViews(segments), capture: meeting.CaptureStatus, processing: meeting.ProcessingStatus, captureFailureMessage: meeting.CaptureFailureMessage, processingFailureMessage: meeting.ProcessingFailureMessage}
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

func buildSegmentViews(segments []db.Segment) []MeetingSegment {
	views := make([]MeetingSegment, 0, len(segments))
	for _, segment := range segments {
		views = append(views, MeetingSegment{StartSec: segment.Start, EndSec: segment.End, Speaker: segment.Speaker, Text: segment.Text})
	}
	return views
}

func RenderMeetingListLine(view MeetingListItem) string {
	return fmt.Sprintf("  %s %s  %s  %s (capture: %s, processing: %s)", meetingMarker(view.Status.State), view.shortID, view.date, view.Title, view.capture, view.processing)
}

func RenderMeetingDetail(view MeetingDetail) string {
	var b strings.Builder
	writeMeetingHeader(&b, view)
	writeMeetingTranscript(&b, view)
	writeMeetingSummary(&b, view)
	return b.String()
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
