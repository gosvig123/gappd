package transcribe

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"unicode/utf8"
)

type Segment struct {
	Start, End           float64
	GroupStart, GroupEnd float64
	Text                 string
	Speaker              string
}

type appleSpeechOutput struct {
	Segments []appleSpeechSegment `json:"segments"`
}

type appleSpeechSegment struct {
	Start float64           `json:"start"`
	End   float64           `json:"end"`
	Text  string            `json:"text"`
	Words []appleSpeechWord `json:"words"`
}

type appleSpeechWord struct {
	Start *float64 `json:"start"`
	End   *float64 `json:"end"`
	Text  string   `json:"text"`
}

const (
	targetSegmentSeconds  = 4.0
	maximumSegmentSeconds = 6.0
	clausePunctuation     = ".,!?;:。،，！？；：؟؛"
)

func TranscribeFile(ctx context.Context, audioPath, locale string) ([]Segment, error) {
	out, err := runAppleSpeech(ctx, audioPath, speechLocaleOr(locale))
	if err != nil {
		return nil, err
	}
	return parseAppleSpeechJSON(out)
}

func PrepareSpeechAsset(ctx context.Context) error {
	_, err := runAppleSpeech(ctx, "--prepare", speechLocale())
	return err
}

func speechLocaleOr(locale string) string {
	if locale != "" {
		return locale
	}
	return speechLocale()
}

func runAppleSpeech(ctx context.Context, args ...string) ([]byte, error) {
	bin, err := findAppleSpeechBinary()
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	out, err := cmd.Output()
	if err != nil {
		return nil, appleSpeechError(err)
	}
	return out, nil
}

func appleSpeechError(err error) error {
	stderr := ""
	if exitErr, ok := err.(*exec.ExitError); ok {
		stderr = string(exitErr.Stderr)
	}
	return fmt.Errorf("apple speech transcription failed: %w\n%s", err, stderr)
}

func parseAppleSpeechJSON(data []byte) ([]Segment, error) {
	var output appleSpeechOutput
	if err := json.Unmarshal(data, &output); err != nil {
		return nil, fmt.Errorf("parse apple speech JSON: %w", err)
	}
	return appleSegments(output.Segments)
}

func appleSegments(raw []appleSpeechSegment) ([]Segment, error) {
	segments := make([]Segment, 0, len(raw))
	for i, segment := range raw {
		if segment.End < segment.Start {
			return nil, fmt.Errorf("parse apple speech segment %d: end %.3f before start %.3f", i, segment.End, segment.Start)
		}
		segments = append(segments, splitAppleSpeechSegment(segment)...)
	}
	return segments, nil
}

func splitAppleSpeechSegment(segment appleSpeechSegment) []Segment {
	fallback := []Segment{{Start: segment.Start, End: segment.End, Text: segment.Text, Speaker: "You"}}
	if segment.End-segment.Start <= maximumSegmentSeconds || !validAppleSpeechWords(segment) {
		return fallback
	}
	var chunks []Segment
	start := 0
	for i, word := range segment.Words {
		if i > start && *word.End-*segment.Words[start].Start > maximumSegmentSeconds {
			chunks = append(chunks, appleSpeechChunk(segment.Words[start:i], segment.Start, segment.End))
			start = i
		}
		duration := *word.End - *segment.Words[start].Start
		if duration >= targetSegmentSeconds && endsClause(word.Text) {
			chunks = append(chunks, appleSpeechChunk(segment.Words[start:i+1], segment.Start, segment.End))
			start = i + 1
		}
	}
	if start < len(segment.Words) {
		chunks = append(chunks, appleSpeechChunk(segment.Words[start:], segment.Start, segment.End))
	}
	if len(chunks) < 2 {
		return fallback
	}
	return chunks
}

func validAppleSpeechWords(segment appleSpeechSegment) bool {
	if len(segment.Words) == 0 {
		return false
	}
	var text strings.Builder
	lastEnd := segment.Start
	for _, word := range segment.Words {
		if word.Start == nil || word.End == nil || *word.End <= *word.Start || *word.End-*word.Start > maximumSegmentSeconds ||
			*word.Start < lastEnd || *word.Start < segment.Start || *word.End > segment.End {
			return false
		}
		text.WriteString(word.Text)
		lastEnd = *word.End
	}
	return normalizedText(text.String()) == normalizedText(segment.Text)
}

func appleSpeechChunk(words []appleSpeechWord, groupStart, groupEnd float64) Segment {
	var text strings.Builder
	for _, word := range words {
		text.WriteString(word.Text)
	}
	return Segment{Start: *words[0].Start, End: *words[len(words)-1].End, GroupStart: groupStart, GroupEnd: groupEnd,
		Text: strings.TrimSpace(text.String()), Speaker: "You"}
}

func endsClause(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	last, _ := utf8.DecodeLastRuneInString(text)
	return strings.ContainsRune(clausePunctuation, last)
}

func normalizedText(text string) string {
	return strings.Join(strings.Fields(text), " ")
}
