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

func BuildMeetingListViews(entries []db.MeetingListEntry) []MeetingListItem {
	views := make([]MeetingListItem, 0, len(entries))
	for _, entry := range entries {
		views = append(views, BuildMeetingListView(entry))
	}
	return views
}

func BuildMeetingListView(entry db.MeetingListEntry) MeetingListItem {
	meeting := entry.Meeting
	return MeetingListItem{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: MeetingStatusFor(meeting), HasTranscript: entry.HasTranscript, HasSummary: entry.HasSummary}
}

func BuildMeetingDetailView(store *db.DB, id string) (MeetingDetail, error) {
	meeting, segments, err := loadMeetingDetail(store, id)
	if err != nil {
		return MeetingDetail{}, err
	}
	return BuildMeetingDetail(*meeting, segments), nil
}

func BuildAppMeetingDetailView(store *db.DB, id string) (MeetingDetail, error) {
	meeting, segments, err := loadMeetingDetail(store, id)
	if err != nil {
		return MeetingDetail{}, err
	}
	return BuildAppMeetingDetail(*meeting, segments), nil
}

func loadMeetingDetail(store *db.DB, id string) (*db.Meeting, []db.Segment, error) {
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return nil, nil, err
	}
	segments, err := store.GetSegments(id)
	return meeting, segments, err
}

func BuildMeetingDetail(meeting db.Meeting, segments []db.Segment) MeetingDetail {
	return buildMeetingDetail(meeting, segments, transcriptText(meeting, segments))
}

func BuildAppMeetingDetail(meeting db.Meeting, segments []db.Segment) MeetingDetail {
	return buildMeetingDetail(meeting, segments, appTranscriptText(meeting, segments))
}

func buildMeetingDetail(meeting db.Meeting, segments []db.Segment, transcript string) MeetingDetail {
	status := MeetingStatusFor(meeting)
	return MeetingDetail{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: status, TranscriptText: transcript, Summary: stringValue(meeting.Summary), Segments: buildSegmentViews(segments)}
}

func appTranscriptText(meeting db.Meeting, segments []db.Segment) string {
	if len(segments) > 0 {
		return ""
	}
	return transcriptText(meeting, segments)
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
