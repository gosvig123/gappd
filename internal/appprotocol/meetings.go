package appprotocol

import (
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/recording"
)

type MeetingListItem struct {
	ID            string        `json:"id"`
	Title         string        `json:"title"`
	StartedAt     string        `json:"startedAt"`
	EndedAt       *string       `json:"endedAt,omitempty"`
	Status        MeetingStatus `json:"status"`
	HasTranscript bool          `json:"hasTranscript"`
	HasSummary    bool          `json:"hasSummary"`
	SearchText    string        `json:"searchText,omitempty"`
}

type MeetingDetail struct {
	ID             string           `json:"id"`
	Title          string           `json:"title"`
	StartedAt      string           `json:"startedAt"`
	EndedAt        *string          `json:"endedAt,omitempty"`
	Status         MeetingStatus    `json:"status"`
	TranscriptText string           `json:"transcriptText,omitempty"`
	Summary        string           `json:"summary,omitempty"`
	Segments       []MeetingSegment `json:"segments"`
}

type MeetingSegment struct {
	ID       string  `json:"id"`
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
	return MeetingListItem{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: MeetingStatusFor(meeting), HasTranscript: meeting.Transcript != nil, HasSummary: meeting.Summary != nil, SearchText: meetingSearchText(meeting)}
}

func meetingSearchText(meeting db.Meeting) string {
	return meeting.Title + "\n" + stringValue(meeting.Summary) + "\n" + stringValue(meeting.Transcript)
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
	status := MeetingStatusFor(meeting)
	return MeetingDetail{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: status, TranscriptText: transcriptText(meeting, segments), Summary: stringValue(meeting.Summary), Segments: buildSegmentViews(segments)}
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
		views = append(views, buildSegmentView(segment))
	}
	return views
}

func buildSegmentView(segment db.Segment) MeetingSegment {
	return MeetingSegment{ID: segment.ID, StartSec: segment.Start, EndSec: segment.End, Speaker: segment.Speaker, Text: segment.Text}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
