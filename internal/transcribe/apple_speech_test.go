package transcribe

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseAppleSpeechJSON(t *testing.T) {
	data := []byte(`{"segments":[{"start":1.25,"end":2.5,"text":" hello "}]}`)

	got, err := parseAppleSpeechJSON(data)
	if err != nil {
		t.Fatalf("parseAppleSpeechJSON() error = %v", err)
	}
	if len(got) != 1 || got[0].Start != 1.25 || got[0].End != 2.5 || got[0].Text != " hello " {
		t.Fatalf("segments = %#v, want parsed segment", got)
	}
}

func TestParseAppleSpeechJSONSplitsLongTimedSegments(t *testing.T) {
	data := []byte(`{"segments":[{"start":0,"end":12,"text":"One two three, four five six seven.","words":[{"start":0,"end":1,"text":" One"},{"start":1,"end":2,"text":" two"},{"start":2,"end":4.2,"text":" three,"},{"start":4.2,"end":5,"text":" four"},{"start":5,"end":6,"text":" five"},{"start":6,"end":7,"text":" six"},{"start":7,"end":10.5,"text":" seven."}]}]}`)

	got, err := parseAppleSpeechJSON(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Start != 0 || got[0].End != 4.2 || got[0].Text != "One two three," ||
		got[1].Start != 4.2 || got[1].End != 7 || got[1].Text != "four five six" ||
		got[2].Start != 7 || got[2].End != 10.5 || got[2].Text != "seven." {
		t.Fatalf("segments = %#v", got)
	}
	for _, segment := range got {
		if segment.GroupStart != 0 || segment.GroupEnd != 12 || segment.End-segment.Start > maximumSegmentSeconds {
			t.Fatalf("segment = %#v", segment)
		}
	}
}

func TestParseAppleSpeechJSONKeepsFallbackSegments(t *testing.T) {
	tests := map[string]struct {
		data []byte
		text string
	}{
		"short":          {[]byte(`{"segments":[{"start":0,"end":3,"text":"short phrase","words":[{"start":0,"end":1,"text":" short"},{"start":1,"end":3,"text":" phrase"}]}]}`), "short phrase"},
		"mismatched":     {[]byte(`{"segments":[{"start":0,"end":8,"text":"original phrase","words":[{"start":0,"end":8,"text":" different"}]}]}`), "original phrase"},
		"overlapping":    {[]byte(`{"segments":[{"start":0,"end":8,"text":"one two","words":[{"start":0,"end":5,"text":" one"},{"start":4,"end":8,"text":" two"}]}]}`), "one two"},
		"zero duration":  {[]byte(`{"segments":[{"start":0,"end":8,"text":"one two","words":[{"start":0,"end":0,"text":" one"},{"start":0,"end":8,"text":" two"}]}]}`), "one two"},
		"missing timing": {[]byte(`{"segments":[{"start":0,"end":8,"text":"one two","words":[{"end":1,"text":" one"},{"start":1,"end":8,"text":" two"}]}]}`), "one two"},
		"null timing":    {[]byte(`{"segments":[{"start":0,"end":8,"text":"one two","words":[{"start":null,"end":1,"text":" one"},{"start":1,"end":8,"text":" two"}]}]}`), "one two"},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			got, err := parseAppleSpeechJSON(test.data)
			if err != nil || len(got) != 1 || got[0].Text != test.text {
				t.Fatalf("segments = %#v, err = %v", got, err)
			}
		})
	}
}

func TestParseAppleSpeechJSONRejectsEndBeforeStart(t *testing.T) {
	data := []byte(`{"segments":[{"start":2,"end":1.5,"text":"hello"}]}`)

	_, err := parseAppleSpeechJSON(data)
	if err == nil {
		t.Fatal("parseAppleSpeechJSON succeeded for invalid segment ordering")
	}
	if !strings.Contains(err.Error(), "before start") {
		t.Fatalf("parseAppleSpeechJSON error = %q, want end-before-start message", err)
	}
}

func TestFindAppleSpeechBinaryUsesEnvOverride(t *testing.T) {
	bin := executableFixture(t, "apple-speech-transcriber")
	t.Setenv(appleSpeechBinEnv, bin)
	t.Setenv("PATH", "")

	got, err := findAppleSpeechBinary()
	if err != nil {
		t.Fatalf("findAppleSpeechBinary() error = %v", err)
	}
	if got != bin {
		t.Fatalf("findAppleSpeechBinary() = %q, want %q", got, bin)
	}
}

func TestFindAppleSpeechBinaryRejectsInvalidEnvOverride(t *testing.T) {
	t.Setenv(appleSpeechBinEnv, filepath.Join(t.TempDir(), "missing-helper"))
	t.Setenv("PATH", "")

	_, err := findAppleSpeechBinary()
	if err == nil {
		t.Fatal("findAppleSpeechBinary succeeded for missing override")
	}
	if !strings.Contains(err.Error(), "override not found") {
		t.Fatalf("findAppleSpeechBinary error = %q, want override-not-found message", err)
	}
}

func TestFindAppleSpeechBinaryFallsBackToPath(t *testing.T) {
	dir := t.TempDir()
	bin := executableFixtureAt(t, filepath.Join(dir, appleSpeechBinaryName))
	t.Setenv(appleSpeechBinEnv, "")
	t.Setenv("PATH", dir)

	got, err := findAppleSpeechBinary()
	if err != nil {
		t.Fatalf("findAppleSpeechBinary() error = %v", err)
	}
	if got != bin {
		t.Fatalf("findAppleSpeechBinary() = %q, want %q", got, bin)
	}
}

func executableFixture(t *testing.T, name string) string {
	t.Helper()
	return executableFixtureAt(t, filepath.Join(t.TempDir(), name))
}

func executableFixtureAt(t *testing.T, path string) string {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return path
}
