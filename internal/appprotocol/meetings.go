package appprotocol

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/meetinglang"
)

type MeetingListItem struct {
	ID            string           `json:"id"`
	Title         string           `json:"title"`
	TitleSource   string           `json:"titleSource,omitempty"`
	StartedAt     string           `json:"startedAt"`
	EndedAt       *string          `json:"endedAt,omitempty"`
	Status        MeetingStatus    `json:"status"`
	HasTranscript bool             `json:"hasTranscript"`
	HasSummary    bool             `json:"hasSummary"`
	Speakers      []MeetingSpeaker `json:"speakers"`
	DocumentStamp string           `json:"documentStamp,omitempty"`
}

type MeetingSearchInput struct {
	Query string `json:"query"`
}

type MeetingSearchResponse struct {
	IDs []string `json:"ids"`
}

type MeetingDetail struct {
	ID                    string           `json:"id"`
	Title                 string           `json:"title"`
	StartedAt             string           `json:"startedAt"`
	EndedAt               *string          `json:"endedAt,omitempty"`
	Status                MeetingStatus    `json:"status"`
	Language              string           `json:"language"`
	TranscriptText        string           `json:"transcriptText,omitempty"`
	TranscriptProvisional bool             `json:"transcriptProvisional"`
	Summary               string           `json:"summary,omitempty"`
	Speakers              []MeetingSpeaker `json:"speakers"`
	SummaryUpdating       bool             `json:"summaryUpdating"`
	Segments              []MeetingSegment `json:"segments"`
	Diarization           DiarizationInfo  `json:"diarization"`
}

type DiarizationInfo struct {
	State        db.DiarizationState `json:"state"`
	Error        *string             `json:"error,omitempty"`
	SpeakerCount *int                `json:"speakerCount,omitempty"`
}

type MeetingSegment struct {
	ID         string  `json:"id"`
	StartSec   float64 `json:"startSec"`
	EndSec     float64 `json:"endSec"`
	Speaker    string  `json:"speaker"`
	SpeakerKey string  `json:"speakerKey"`
	Text       string  `json:"text"`
}

func BuildMeetingListViews(entries []db.MeetingListEntry, speakersByMeeting map[string][]db.MeetingSpeakerSummary) []MeetingListItem {
	views := make([]MeetingListItem, 0, len(entries))
	for _, entry := range entries {
		views = append(views, BuildMeetingListView(entry, speakersByMeeting[entry.Meeting.ID]))
	}
	return views
}

func BuildMeetingListView(entry db.MeetingListEntry, speakers []db.MeetingSpeakerSummary) MeetingListItem {
	meeting := entry.Meeting
	outSpeakers := make([]MeetingSpeaker, 0, len(speakers))
	for _, speaker := range speakers {
		outSpeakers = append(outSpeakers, MeetingSpeaker{
			Key:               speaker.Key,
			Name:              speaker.Name,
			PersonID:          speaker.PersonID,
			IdentityOrigin:    speaker.IdentityOrigin,
			SuggestedPersonID: speaker.SuggestedPersonID,
		})
	}
	return MeetingListItem{ID: meeting.ID, Title: meeting.Title, TitleSource: meeting.TitleSource, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: MeetingStatusFor(meeting), HasTranscript: entry.HasTranscript, HasSummary: entry.HasSummary, Speakers: outSpeakers, DocumentStamp: DocumentStamp(meeting)}
}

// DocumentStamp fingerprints every Meeting field that feeds meetingdocument.Build (including the
// summary text itself and persisted title provenance) so cloud sync skips exporting unchanged
// Meetings without missing same-second note refinements.
func DocumentStamp(meeting db.Meeting) string {
	sum := sha256.New()
	fmt.Fprintf(sum, "v2\x00%s\x00%s\x00%s\x00%s\x00%s\x00%d\x00%d\x00%s\x00%s",
		meeting.Title, meeting.TitleSource, meeting.StartedAt, stringValue(meeting.EndedAt),
		meeting.Language, meeting.TranscriptRevision, meeting.SummaryTranscriptRevision,
		stringValue(meeting.Summary), meeting.ProcessingStatusUpdatedAt)
	return hex.EncodeToString(sum.Sum(nil))
}

func BuildMeetingDetail(meeting db.Meeting, segments []db.Segment) MeetingDetail {
	return buildMeetingDetail(meeting, segments, transcriptText(meeting, segments))
}

func BuildAppMeetingDetail(meeting db.Meeting, segments []db.Segment) MeetingDetail {
	return buildMeetingDetail(meeting, segments, appTranscriptText(meeting, segments))
}

func buildMeetingDetail(meeting db.Meeting, segments []db.Segment, transcript string) MeetingDetail {
	status := MeetingStatusFor(meeting)
	visible := visibleTranscriptSegments(meeting, segments)
	provisional := meeting.Transcript == nil && len(visible) > 0
	return MeetingDetail{ID: meeting.ID, Title: meeting.Title, StartedAt: meeting.StartedAt, EndedAt: meeting.EndedAt, Status: status, Language: meetinglang.Normalize(meeting.Language), TranscriptText: transcript, TranscriptProvisional: provisional, Summary: stringValue(meeting.Summary), Segments: buildSegmentViews(visible), Speakers: buildSpeakerViews(visible), SummaryUpdating: summaryUpdating(meeting), Diarization: diarizationInfo(meeting)}
}

func diarizationInfo(meeting db.Meeting) DiarizationInfo {
	info := DiarizationInfo{State: meeting.DiarizationState}
	if meeting.DiarizationError != nil {
		message := "Speaker labeling unavailable."
		info.Error = &message
	}
	if meeting.DiarizationState == db.DiarizationStateCompleted && meeting.DiarizationJSON != nil {
		var provenance struct {
			SpeakerCount *int `json:"speakerCount"`
		}
		if json.Unmarshal([]byte(*meeting.DiarizationJSON), &provenance) == nil && provenance.SpeakerCount != nil && *provenance.SpeakerCount >= 0 {
			info.SpeakerCount = provenance.SpeakerCount
		}
	}
	return info
}

func appTranscriptText(meeting db.Meeting, segments []db.Segment) string {
	if len(visibleTranscriptSegments(meeting, segments)) > 0 {
		return ""
	}
	return transcriptText(meeting, segments)
}

func transcriptText(meeting db.Meeting, segments []db.Segment) string {
	if meeting.Transcript != nil {
		return *meeting.Transcript
	}
	visible := visibleTranscriptSegments(meeting, segments)
	if len(visible) == 0 {
		return ""
	}
	return db.FormatTranscript(visible)
}

func visibleTranscriptSegments(meeting db.Meeting, segments []db.Segment) []db.Segment {
	incomplete := meeting.CaptureStatus == db.CaptureStatusCaptured &&
		meeting.ProcessingStatus == db.ProcessingStatusPending && meeting.Transcript == nil
	if incomplete {
		return nil
	}
	return segments
}

func buildSegmentViews(segments []db.Segment) []MeetingSegment {
	views := make([]MeetingSegment, 0, len(segments))
	for _, segment := range segments {
		views = append(views, buildSegmentView(segment))
	}
	return views
}

func buildSegmentView(segment db.Segment) MeetingSegment {
	return MeetingSegment{ID: segment.ID, StartSec: segment.Start, EndSec: segment.End, Speaker: segment.Speaker, SpeakerKey: segment.RawSpeaker(), Text: segment.Text}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func summaryUpdating(meeting db.Meeting) bool {
	return meeting.Summary != nil && *meeting.Summary != "" && meeting.TranscriptRevision > meeting.SummaryTranscriptRevision &&
		(meeting.ProcessingStatus == db.ProcessingStatusPending || meeting.ProcessingStatus == db.ProcessingStatusProcessing)
}
