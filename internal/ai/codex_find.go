package ai

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// CodexInstall is an installed Codex CLI that Gappd found on this Mac.
// Executable is empty when no install was found.
type CodexInstall struct {
	Executable string
	Version    string
	SignedIn   bool
}

var (
	codexVersionPattern = regexp.MustCompile(`(\d+)\.(\d+)\.(\d+)`)
	codexShellTimeout   = 5 * time.Second
)

// FindCodex looks for Codex where its installers put it, because a Mac app
// does not inherit the user's shell PATH. The ChatGPT app ships its own Codex
// CLI. When several installs exist, the newest version wins.
func FindCodex() CodexInstall {
	var best CodexInstall
	var bestVersion [3]int
	for _, path := range codexCandidates() {
		if validateCodexExecutable(path) != nil {
			continue
		}
		output, err := NewCodexExec(path, "", "").probe("--version")
		if err != nil {
			continue
		}
		version, ok := parseCodexVersion(output)
		if !ok || best.Executable != "" && !newerCodexVersion(version, bestVersion) {
			continue
		}
		best, bestVersion = CodexInstall{Executable: path, Version: strings.TrimSpace(output)}, version
	}
	if best.Executable != "" {
		_, err := NewCodexExec(best.Executable, "", "").probe("login", "status")
		best.SignedIn = err == nil
	}
	return best
}

func codexCandidates() []string {
	paths := []string{
		"/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
	}
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths,
			filepath.Join(home, "Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"),
			filepath.Join(home, ".local/bin/codex"),
			filepath.Join(home, ".npm-global/bin/codex"),
			filepath.Join(home, ".bun/bin/codex"),
			filepath.Join(home, ".volta/bin/codex"),
		)
	}
	if path := codexFromLoginShell(); path != "" {
		paths = append(paths, path)
	}
	return paths
}

// codexFromLoginShell asks the user's login shell, which finds installs from
// version managers such as nvm that use a per-version directory.
func codexFromLoginShell() string {
	shell := os.Getenv("SHELL")
	if !filepath.IsAbs(shell) {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), codexShellTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, shell, "-lc", "command -v codex").Output()
	if err != nil {
		return ""
	}
	path := strings.TrimSpace(string(output))
	if !filepath.IsAbs(path) {
		return ""
	}
	return path
}

func parseCodexVersion(output string) ([3]int, bool) {
	match := codexVersionPattern.FindStringSubmatch(output)
	if match == nil {
		return [3]int{}, false
	}
	var version [3]int
	for i := range version {
		version[i], _ = strconv.Atoi(match[i+1])
	}
	return version, true
}

func newerCodexVersion(a, b [3]int) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
