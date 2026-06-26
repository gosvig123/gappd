package transcribe

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

type Segment struct {
	Start   float64
	End     float64
	Text    string
	Speaker string
}

type whisperOutput struct {
	Transcription []whisperSegment `json:"transcription"`
}

type whisperSegment struct {
	Timestamps struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"timestamps"`
	Text string `json:"text"`
}

var whisperTimestampPattern = regexp.MustCompile(`^\d{2}:\d{2}:\d{2},\d{3}$`)

func TranscribeFile(ctx context.Context, audioPath, modelPath string) ([]Segment, error) {
	bin, err := findWhisperBinary()
	if err != nil {
		return nil, err
	}
	segments, _, err := transcribeWithBounds(ctx, bin, audioPath, modelPath, false)
	if err != nil || !hasDominantRepeatedText(segments) {
		return segments, err
	}
	return transcribeFallbackWindows(ctx, bin, audioPath, modelPath, segments)
}

func transcribeFallbackWindows(ctx context.Context, bin, audioPath, modelPath string, original []Segment) ([]Segment, error) {
	segments, bounded, err := transcribeWithBounds(ctx, bin, audioPath, modelPath, true)
	if err != nil || !bounded || len(segments) == 0 {
		return original, err
	}
	return segments, nil
}

func transcribeWithBounds(ctx context.Context, bin, audioPath, modelPath string, allowBounds bool) ([]Segment, bool, error) {
	windows, ok := activeWindows(audioPath, allowBounds)
	if !ok {
		segments, err := transcribeWindow(ctx, bin, audioPath, modelPath, whisperBounds{}, false)
		return segments, false, err
	}
	return transcribeWindows(ctx, bin, audioPath, modelPath, windows)
}

func activeWindows(audioPath string, allow bool) ([]whisperBounds, bool) {
	if !allow {
		return nil, false
	}
	return activeWhisperWindows(audioPath)
}

func transcribeWindows(ctx context.Context, bin, audioPath, modelPath string, windows []whisperBounds) ([]Segment, bool, error) {
	segments := []Segment{}
	for _, window := range windows {
		windowSegments, err := transcribeWindow(ctx, bin, audioPath, modelPath, window, true)
		if err != nil {
			return nil, true, err
		}
		segments = append(segments, windowSegments...)
	}
	return segments, true, nil
}

func transcribeWindow(ctx context.Context, bin, audioPath, modelPath string, bounds whisperBounds, bounded bool) ([]Segment, error) {
	out, err := runWhisper(ctx, bin, whisperArgs(audioPath, modelPath, bounds, bounded))
	if err != nil {
		return nil, err
	}
	return parseWhisperJSON(out)
}

func runWhisper(ctx context.Context, bin string, args []string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	out, err := cmd.Output()
	if err != nil {
		return nil, whisperError(err)
	}
	return out, nil
}

func whisperError(err error) error {
	stderr := ""
	if exitErr, ok := err.(*exec.ExitError); ok {
		stderr = string(exitErr.Stderr)
	}
	return fmt.Errorf("whisper failed: %w\n%s", err, stderr)
}

func whisperArgs(audioPath, modelPath string, bounds whisperBounds, bounded bool) []string {
	args := []string{"-m", modelPath, "-f", audioPath, "-oj", "-of", "-", "-np"}
	if !bounded {
		return args
	}
	args = append(args, "-ml", whisperMaxSegmentRunes, "-sow")
	return append(args, "-ot", strconv.Itoa(bounds.offsetMS), "-d", strconv.Itoa(bounds.durationMS))
}

func hasDominantRepeatedText(segments []Segment) bool {
	if len(segments) < repeatedTextMinSegments {
		return false
	}
	counts := map[string]int{}
	maxCount := 0
	for _, segment := range segments {
		maxCount = max(maxCount, countRepeatedText(counts, segment.Text))
	}
	return maxCount >= repeatedTextMinSegments && float64(maxCount)/float64(len(segments)) >= repeatedTextDominance
}

func countRepeatedText(counts map[string]int, text string) int {
	text = strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(text)), repeatedTextSeparator))
	if len([]rune(text)) < repeatedTextMinRunes {
		return 0
	}
	counts[text]++
	return counts[text]
}

func parseWhisperJSON(data []byte) ([]Segment, error) {
	jsonStart := findJSONStart(data)
	if jsonStart == -1 {
		return nil, fmt.Errorf("no JSON found in whisper output")
	}

	var wo whisperOutput
	if err := json.Unmarshal(data[jsonStart:], &wo); err != nil {
		return nil, fmt.Errorf("parse whisper JSON: %w", err)
	}

	segments := make([]Segment, 0, len(wo.Transcription))
	for i, ws := range wo.Transcription {
		start, err := parseTimestamp(ws.Timestamps.From)
		if err != nil {
			return nil, fmt.Errorf("parse whisper segment %d start timestamp: %w", i, err)
		}
		end, err := parseTimestamp(ws.Timestamps.To)
		if err != nil {
			return nil, fmt.Errorf("parse whisper segment %d end timestamp: %w", i, err)
		}
		if end < start {
			return nil, fmt.Errorf("parse whisper segment %d: end timestamp %q before start %q", i, ws.Timestamps.To, ws.Timestamps.From)
		}
		segments = append(segments, Segment{
			Start:   start,
			End:     end,
			Text:    strings.TrimSpace(ws.Text),
			Speaker: "You",
		})
	}
	return segments, nil
}

func findJSONStart(data []byte) int {
	for i, b := range data {
		if b == '{' {
			return i
		}
	}
	return -1
}

func parseTimestamp(ts string) (float64, error) {
	ts = strings.TrimSpace(ts)
	if !whisperTimestampPattern.MatchString(ts) {
		return 0, fmt.Errorf("invalid timestamp format: %q", ts)
	}

	var h, m, s, ms int
	if _, err := fmt.Sscanf(ts, "%02d:%02d:%02d,%03d", &h, &m, &s, &ms); err != nil {
		return 0, fmt.Errorf("parse timestamp %q: %w", ts, err)
	}
	if m > 59 || s > 59 {
		return 0, fmt.Errorf("invalid timestamp value: %q", ts)
	}
	return float64(h)*3600 + float64(m)*60 + float64(s) + float64(ms)/1000, nil
}
