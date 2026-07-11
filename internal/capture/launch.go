package capture

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type captureLaunch struct {
	command string
	args    []string
}

func appendChunkArgs(args []string) []string {
	seconds := strings.TrimSpace(os.Getenv(captureChunkSecondsEnv))
	if seconds == "" {
		return args
	}
	return append(args, "--chunk-seconds", seconds)
}

func findCaptureLaunch(args []string, _ string) (captureLaunch, error) {
	bin, err := findCaptureBinary()
	if err != nil {
		return captureLaunch{}, err
	}
	return captureLaunch{command: bin, args: args}, nil
}

func captureStartFailure(err error, stderr, stdout string) error {
	msg := startupOutput(stderr, stdout)
	if err == nil && msg != "" {
		return fmt.Errorf("capture process exited immediately: %s", msg)
	}
	if err == nil {
		return fmt.Errorf("capture process exited immediately")
	}
	if msg != "" {
		return fmt.Errorf("capture process failed to start: %w: %s", err, msg)
	}
	return fmt.Errorf("capture process failed to start: %w", err)
}

func startupOutput(stderr, stdout string) string {
	parts := []string{}
	if msg := strings.TrimSpace(stderr); msg != "" {
		parts = append(parts, msg)
	}
	if msg := strings.TrimSpace(stdout); msg != "" {
		parts = append(parts, msg)
	}
	return strings.Join(parts, "\n")
}

func findCaptureBinary() (string, error) {
	if override := strings.TrimSpace(os.Getenv(captureHelperEnv)); override != "" {
		if found, ok := existingPath(override); ok {
			return found, nil
		}
		return "", fmt.Errorf("capture helper override not found: %s", override)
	}
	for _, path := range captureBinaryCandidates() {
		if found, ok := existingPath(path); ok {
			return found, nil
		}
	}
	return "", fmt.Errorf("gappd-capture not found (set GAPPD_CAPTURE_HELPER_PATH or run: make build-capture)")
}

func existingPath(path string) (string, bool) {
	cleaned := strings.TrimSpace(path)
	if cleaned == "" {
		return "", false
	}
	_, err := os.Stat(cleaned)
	return cleaned, err == nil
}

func captureBinaryCandidates() []string {
	home, _ := os.UserHomeDir()
	installed := filepath.Join(home, ".gappd", "GappdCapture.app", "Contents", "MacOS", "gappd-capture")
	return append(bundleCaptureCandidates(), installed, "./build/GappdCapture.app/Contents/MacOS/gappd-capture")
}

func bundleCaptureCandidates() []string {
	exePath, err := os.Executable()
	if err != nil {
		return nil
	}
	if resolvedPath, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolvedPath
	}
	exeDir := filepath.Dir(exePath)
	return []string{
		filepath.Join(exeDir, "GappdCapture.app", "Contents", "MacOS", "gappd-capture"),
		filepath.Join(exeDir, "..", "GappdCapture.app", "Contents", "MacOS", "gappd-capture"),
		filepath.Join(exeDir, "..", "Resources", "GappdCapture.app", "Contents", "MacOS", "gappd-capture"),
	}
}
