package meetinglifecycle

import "strings"

const (
	generatedMeetingTitleMaxRunes       = 80
	genericMeetingTitleMeeting          = "meeting"
	genericMeetingTitleRecording        = "recording"
	genericMeetingTitleRecordedDialogue = "recorded conversation"
)

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
