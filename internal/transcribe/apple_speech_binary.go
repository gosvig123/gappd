package transcribe

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	appleSpeechBinaryName = "apple-speech-transcriber"
	appleSpeechBinEnv     = "GAPPD_APPLE_SPEECH_BIN"
	appleSpeechLocaleEnv  = "GAPPD_SPEECH_LOCALE"
	defaultSpeechLocale   = "en_US"
)

func findAppleSpeechBinary() (string, error) {
	if override := strings.TrimSpace(os.Getenv(appleSpeechBinEnv)); override != "" {
		return executableOverride(override)
	}
	for _, candidate := range appleSpeechCandidates() {
		if ok, _ := isExecutableFile(candidate); ok {
			return candidate, nil
		}
	}
	if path, err := exec.LookPath(appleSpeechBinaryName); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("apple speech transcriber not found (set %s or build %s)", appleSpeechBinEnv, appleSpeechBinaryName)
}

func executableOverride(path string) (string, error) {
	if ok, err := isExecutableFile(path); err != nil {
		return "", fmt.Errorf("apple speech transcriber override not found: %s", path)
	} else if ok {
		return path, nil
	}
	return "", fmt.Errorf("apple speech transcriber override is not an executable file: %s", path)
}

func appleSpeechCandidates() []string {
	exe, err := os.Executable()
	if err != nil {
		return []string{filepath.Join("build", appleSpeechBinaryName)}
	}
	dir := filepath.Dir(exe)
	return []string{
		filepath.Join(dir, "..", "GappdSpeechTranscriber.app", "Contents", "MacOS", appleSpeechBinaryName),
		filepath.Join(dir, "GappdSpeechTranscriber.app", "Contents", "MacOS", appleSpeechBinaryName),
		filepath.Join(dir, appleSpeechBinaryName),
		filepath.Join("build", "GappdSpeechTranscriber.app", "Contents", "MacOS", appleSpeechBinaryName),
		filepath.Join("build", appleSpeechBinaryName),
	}
}

func speechLocale() string {
	if locale := strings.TrimSpace(os.Getenv(appleSpeechLocaleEnv)); locale != "" {
		return locale
	}
	return defaultSpeechLocale
}

func isExecutableFile(path string) (bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	return info.Mode().IsRegular() && info.Mode()&0o111 != 0, nil
}
