package ai

import "strings"

const (
	keyTopicsHeadingText = "key topics"
	meetingTitleText     = "meeting title"
)

func enforceStructuredNotes(value string, extraction *Extraction) string {
	if extraction.Title != "" {
		value = replaceMarkdownSection(value, meetingTitleText, extraction.Title)
	}
	value = replaceMarkdownSection(value, keyTopicsHeadingText, topicSectionBody(extraction.Topics))
	value = replaceMarkdownSection(value, decisionsHeadingText, decisionSectionBody(extraction.Decisions))
	value = replaceMarkdownSection(value, actionItemsHeadingText, actionSectionBody(extraction.ActionItems))
	return replaceMarkdownSection(value, openQuestionsHeadingText, questionSectionBody(extraction.OpenQuestions))
}

func topicSectionBody(values []Topic) string {
	if len(values) == 0 {
		return noneIdentifiedText
	}
	lines := make([]string, 0, len(values))
	for _, value := range values {
		lines = append(lines, "- "+value.Name+summarySuffix(value.Summary))
	}
	return strings.Join(lines, "\n")
}

func decisionSectionBody(values []Decision) string {
	if len(values) == 0 {
		return noneIdentifiedText
	}
	lines := make([]string, 0, len(values))
	for _, value := range values {
		lines = append(lines, "- "+decisionLabel(value)+value.What)
	}
	return strings.Join(lines, "\n")
}

func actionSectionBody(values []ExtractedAction) string {
	if len(values) == 0 {
		return noneIdentifiedText
	}
	lines := make([]string, 0, len(values))
	for _, value := range values {
		lines = append(lines, "- [ ] "+actionText(value))
	}
	return strings.Join(lines, "\n")
}

func questionSectionBody(values []string) string {
	if len(values) == 0 {
		return noneIdentifiedText
	}
	lines := make([]string, 0, len(values))
	for _, value := range values {
		lines = append(lines, "- "+value)
	}
	return strings.Join(lines, "\n")
}

func decisionLabel(value Decision) string {
	switch value.Status {
	case decisionStatusRejected:
		return "Rejected option: "
	case decisionStatusTentative:
		return "Tentative plan: "
	default:
		return ""
	}
}

func actionText(value ExtractedAction) string {
	parts := []string{value.Task}
	if value.Owner != "" {
		parts = append(parts, "owner: "+value.Owner)
	}
	if value.Deadline != "" {
		parts = append(parts, "due: "+value.Deadline)
	}
	return joinInlineDetails(parts)
}

func summarySuffix(value string) string {
	if value == "" {
		return ""
	}
	return " — " + value
}

func joinInlineDetails(parts []string) string {
	if len(parts) == 1 {
		return parts[0]
	}
	return parts[0] + " (" + strings.Join(parts[1:], ", ") + ")"
}
