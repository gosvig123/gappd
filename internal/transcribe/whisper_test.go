package transcribe

import (
	"strings"
	"testing"
)

func TestParseTimestampValid(t *testing.T) {
	got, err := parseTimestamp("01:02:03,456")
	if err != nil {
		t.Fatalf("parseTimestamp returned error: %v", err)
	}

	want := 3723.456
	if got != want {
		t.Fatalf("parseTimestamp = %v, want %v", got, want)
	}
}

func TestParseTimestampMalformed(t *testing.T) {
	_, err := parseTimestamp("1:02:03.456")
	if err == nil {
		t.Fatal("parseTimestamp succeeded for malformed timestamp")
	}
	if !strings.Contains(err.Error(), "invalid timestamp format") {
		t.Fatalf("parseTimestamp error = %q, want invalid format", err)
	}
}

func TestParseWhisperJSONRejectsEndBeforeStart(t *testing.T) {
	data := []byte(`{"transcription":[{"timestamps":{"from":"00:00:02,000","to":"00:00:01,500"},"text":" hello "}]}`)

	_, err := parseWhisperJSON(data)
	if err == nil {
		t.Fatal("parseWhisperJSON succeeded for invalid segment ordering")
	}
	if !strings.Contains(err.Error(), "before start") {
		t.Fatalf("parseWhisperJSON error = %q, want end-before-start message", err)
	}
}
