package ai

import (
	"regexp"
	"strings"
)

const (
	actionItemsHeadingText   = "action items"
	decisionsHeadingText     = "decisions"
	openQuestionsHeadingText = "open questions"
	noneIdentifiedText       = "None identified"
)

var (
	markdownHeadingPattern     = regexp.MustCompile(`^(#{1,6})\s+(.*?)\s*$`)
	actionLinePrefixPattern    = regexp.MustCompile(`^(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?`)
	actionSpeakerPrefixPattern = regexp.MustCompile(`^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?)(?i:You|Other)\s*[:—-]\s*`)
	actionSpeakerOwnerPattern  = regexp.MustCompile(`\s*\(@(?i:You|Other)(?:,\s*due:\s*([^)]*))?\)`)
	unknownDuePattern          = regexp.MustCompile(`\s*\((?i:due(?:\s+by)?\s*:?\s*(?:unknown|unspecified|none|n/a))\)`)
)

func normalizeActionItemsMarkdown(value string) string {
	lines := strings.Split(value, "\n")
	out := make([]string, 0, len(lines))
	actionDepth := 0
	for _, line := range lines {
		nextLine, nextDepth, skip := normalizeMarkdownLine(line, actionDepth)
		actionDepth = nextDepth
		if skip {
			continue
		}
		out = append(out, nextLine)
	}
	return strings.Join(out, "\n")
}

func normalizeNotesMarkdown(value string, extraction *Extraction) string {
	value = normalizeActionItemsMarkdown(value)
	if extraction == nil {
		return value
	}
	for _, heading := range emptyExtractionHeadings(extraction) {
		value = replaceMarkdownSection(value, heading, noneIdentifiedText)
	}
	return value
}

func emptyExtractionHeadings(extraction *Extraction) []string {
	headings := []string{}
	if len(extraction.Decisions) == 0 {
		headings = append(headings, decisionsHeadingText)
	}
	if len(extraction.ActionItems) == 0 {
		headings = append(headings, actionItemsHeadingText)
	}
	if len(extraction.OpenQuestions) == 0 {
		headings = append(headings, openQuestionsHeadingText)
	}
	return headings
}

func replaceMarkdownSection(value, headingText, body string) string {
	lines := strings.Split(value, "\n")
	start, depth := markdownSectionStart(lines, headingText)
	if start < 0 {
		return value
	}
	end := markdownSectionEnd(lines, start+1, depth)
	next := make([]string, 0, len(lines)+1)
	next = append(next, lines[:start+1]...)
	next = append(next, body)
	next = append(next, lines[end:]...)
	return strings.Join(next, "\n")
}

func markdownSectionStart(lines []string, headingText string) (int, int) {
	for index, line := range lines {
		text, depth, heading := parseMarkdownHeading(line)
		if heading && normalizeHeadingText(text) == headingText {
			return index, depth
		}
	}
	return -1, 0
}

func markdownSectionEnd(lines []string, start, depth int) int {
	for index := start; index < len(lines); index++ {
		_, nextDepth, heading := parseMarkdownHeading(lines[index])
		if heading && nextDepth <= depth {
			return index
		}
	}
	return len(lines)
}

func normalizeMarkdownLine(line string, actionDepth int) (string, int, bool) {
	text, depth, heading := parseMarkdownHeading(line)
	if heading && normalizeHeadingText(text) == actionItemsHeadingText {
		return line, depth, false
	}
	if heading && actionDepth > 0 && isTranscriptSpeakerLabel(text) {
		return "", actionDepth, true
	}
	if heading && actionDepth > 0 && depth <= actionDepth {
		return line, 0, false
	}
	if actionDepth == 0 {
		return line, actionDepth, false
	}
	line = normalizeActionItemLine(line)
	return line, actionDepth, isSpeakerOnlyActionLine(line)
}

func parseMarkdownHeading(line string) (string, int, bool) {
	match := markdownHeadingPattern.FindStringSubmatch(line)
	if match == nil {
		return "", 0, false
	}
	return match[2], len(match[1]), true
}

func normalizeHeadingText(text string) string {
	return strings.ToLower(strings.Trim(strings.TrimSpace(text), ":"))
}

func isTranscriptSpeakerLabel(text string) bool {
	switch normalizeHeadingText(text) {
	case "you", "other":
		return true
	default:
		return false
	}
}

func normalizeActionItemLine(line string) string {
	line = actionSpeakerOwnerPattern.ReplaceAllStringFunc(line, replaceTranscriptSpeakerOwner)
	line = unknownDuePattern.ReplaceAllString(line, "")
	return actionSpeakerPrefixPattern.ReplaceAllString(line, `$1`)
}

func replaceTranscriptSpeakerOwner(match string) string {
	parts := actionSpeakerOwnerPattern.FindStringSubmatch(match)
	if len(parts) < 2 {
		return ""
	}
	due := strings.TrimSpace(parts[1])
	if unknownDue(due) {
		return ""
	}
	return " (due: " + due + ")"
}

func unknownDue(value string) bool {
	switch strings.ToLower(value) {
	case "", "unknown", "unspecified", "none", "n/a":
		return true
	default:
		return false
	}
}

func isSpeakerOnlyActionLine(line string) bool {
	text := actionLinePrefixPattern.ReplaceAllString(strings.TrimSpace(line), "")
	return isTranscriptSpeakerLabel(text)
}
