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
