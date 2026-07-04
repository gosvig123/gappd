package transcribe

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
)

type Segment struct {
	Start   float64
	End     float64
	Text    string
	Speaker string
}

type appleSpeechOutput struct {
	Segments []appleSpeechSegment `json:"segments"`
}

type appleSpeechSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

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
		segments = append(segments, Segment{Start: segment.Start, End: segment.End, Text: segment.Text, Speaker: "You"})
	}
	return segments, nil
}
