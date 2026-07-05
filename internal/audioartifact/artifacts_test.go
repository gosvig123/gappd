package audioartifact

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArtifactsSourcesUseCaptureConvention(t *testing.T) {
	artifacts := New("session")
	sources := artifacts.Sources()

	if len(sources) != 2 {
		t.Fatalf("sources = %d, want 2", len(sources))
	}
	assertSource(t, sources[0], filepath.Join("session", MicFilename), MicSpeaker)
	assertSource(t, sources[1], filepath.Join("session", SystemFilename), SystemSpeaker)
}

func TestArtifactsHasAudioWhenAnySourceHasAudio(t *testing.T) {
	dir := t.TempDir()
	artifacts := New(dir)
	writeFile(t, artifacts.MicPath(), strings.Repeat("m", wavHeaderBytes))
	writeFile(t, artifacts.SystemPath(), strings.Repeat("s", wavHeaderBytes+1))

	if !artifacts.HasAudio() {
		t.Fatal("HasAudio() = false, want true")
	}
}

func TestSourceWithoutAudio(t *testing.T) {
	source := Source{Path: filepath.Join(t.TempDir(), MicFilename)}

	if source.HasAudio() {
		t.Fatal("HasAudio() = true, want false")
	}
}

func assertSource(t *testing.T, source Source, path, speaker string) {
	t.Helper()
	if source.Path != path || source.Speaker != speaker {
		t.Fatalf("source = %#v, want path %q speaker %q", source, path, speaker)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}
