package transcribe

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func findWhisperBinary() (string, error) {
	if override := strings.TrimSpace(os.Getenv("GAPPD_WHISPER_BIN")); override != "" {
		if ok, err := isExecutableFile(override); err != nil {
			return "", fmt.Errorf("whisper binary override not found: %s", override)
		} else if ok {
			return override, nil
		}
		return "", fmt.Errorf("whisper binary override is not an executable file: %s", override)
	}
	for _, name := range []string{"whisper-cli", "whisper-cpp", "whisper", "main"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("whisper binary not found (set GAPPD_WHISPER_BIN or install whisper-cpp so whisper-cli, whisper-cpp, whisper, or main is available in PATH)")
}

func isExecutableFile(path string) (bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, nil
	}
	return info.Mode()&0o111 != 0, nil
}
