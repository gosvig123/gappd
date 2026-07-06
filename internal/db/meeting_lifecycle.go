package db

import (
	"strings"

	"github.com/gappd-dev/gappd/internal/meetinglang"
)

const (
	generatedMeetingTitleMaxRunes       = 80
	genericMeetingTitleMeeting          = "meeting"
	genericMeetingTitleRecording        = "recording"
	genericMeetingTitleRecordedDialogue = "recorded conversation"
)

type MeetingLifecycle struct {
	meeting *Meeting
}

func NewRecordingMeeting(title, sessionDir, language, at string) *Meeting {
	return &Meeting{
		Title: title, StartedAt: at, AudioPath: &sessionDir,
		CaptureStatus: CaptureStatusRecording, CaptureStatusUpdatedAt: at,
		ProcessingStatus: ProcessingStatusNotStarted, ProcessingStatusUpdatedAt: at,
		Language: meetinglang.Normalize(language), Source: "listen",
	}
}

func LifecycleFor(meeting *Meeting) MeetingLifecycle {
	return MeetingLifecycle{meeting: meeting}
}

func (l MeetingLifecycle) CaptureFailed(at string, err error) {
	l.end(at)
	l.capture(CaptureStatusFailed, at, err)
}

func (l MeetingLifecycle) Captured(at string) {
	l.end(at)
	l.capture(CaptureStatusCaptured, at, nil)
	l.processing(ProcessingStatusProcessing, at, nil)
}

func (l MeetingLifecycle) ProcessingStarted(at string) {
	l.processing(ProcessingStatusProcessing, at, nil)
}

func (l MeetingLifecycle) ProcessingFailed(at string, err error) {
	if l.meeting.EndedAt == nil {
		l.end(at)
	}
	l.processing(ProcessingStatusFailed, at, err)
}

func (l MeetingLifecycle) TranscriptSaved(transcript, at string) {
	l.meeting.Transcript = &transcript
	l.processing(ProcessingStatusProcessing, at, nil)
}

func (l MeetingLifecycle) ProcessingCompleted(title, transcript, summary, extractionJSON, at string) {
	if title = cleanGeneratedMeetingTitle(title); title != "" {
		l.meeting.Title = title
	}
	l.meeting.Transcript = &transcript
	l.meeting.Summary = &summary
	l.meeting.ExtractionJSON = &extractionJSON
	l.processing(ProcessingStatusCompleted, at, nil)
}

func (l MeetingLifecycle) EnhancementFailed(transcript, at string, err error) {
	l.meeting.Transcript = &transcript
	l.processing(ProcessingStatusFailed, at, err)
}

func cleanGeneratedMeetingTitle(title string) string {
	title = strings.TrimSpace(title)
	title = strings.Trim(title, `"'“”‘’`)
	title = strings.Join(strings.Fields(title), " ")
	if isGenericMeetingTitle(title) {
		return ""
	}
	return trimRunes(title, generatedMeetingTitleMaxRunes)
}

func isGenericMeetingTitle(title string) bool {
	switch strings.ToLower(title) {
	case "", genericMeetingTitleMeeting, genericMeetingTitleRecording, genericMeetingTitleRecordedDialogue:
		return true
	default:
		return false
	}
}

func trimRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func (l MeetingLifecycle) end(at string) {
	l.meeting.EndedAt = &at
}

func (l MeetingLifecycle) capture(status CaptureStatus, at string, err error) {
	l.meeting.CaptureStatus = status
	l.meeting.CaptureStatusUpdatedAt = at
	l.meeting.CaptureFailureMessage = failureMessage(err)
}

func (l MeetingLifecycle) processing(status ProcessingStatus, at string, err error) {
	l.meeting.ProcessingStatus = status
	l.meeting.ProcessingStatusUpdatedAt = at
	l.meeting.ProcessingFailureMessage = failureMessage(err)
}

func failureMessage(err error) *string {
	if err == nil {
		return nil
	}
	message := err.Error()
	return &message
}
