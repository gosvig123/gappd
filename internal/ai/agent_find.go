package ai

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// AgentInstall is an installed agent CLI that Gappd found on this Mac.
// Executable is empty when no install was found.
type AgentInstall struct {
	Agent      string
	Executable string
	Version    string
	SignedIn   bool
}

var (
	agentVersionPattern = regexp.MustCompile(`(\d+)\.(\d+)\.(\d+)`)
	agentShellTimeout   = 5 * time.Second
)

// FindAgents looks for every supported agent at the same time and returns
// them in display order.
func FindAgents() []AgentInstall {
	found := make([]AgentInstall, len(agentIDs))
	var wait sync.WaitGroup
	for index, id := range agentIDs {
		wait.Add(1)
		go func() {
			defer wait.Done()
			found[index] = FindAgent(id)
		}()
	}
	wait.Wait()
	return found
}

// FindAgent looks for one agent where its installers put it, because a Mac
// app does not inherit the user's shell PATH. When several installs exist,
// the newest version wins.
func FindAgent(id string) AgentInstall {
	best := AgentInstall{Agent: id}
	a, err := agentFor(id)
	if err != nil {
		return best
	}
	var bestVersion [3]int
	for _, path := range agentCandidates(a) {
		if validateExecutable(a.name(), path) != nil {
			continue
		}
		output, err := newCLI(a, path).probe("--version")
		if err != nil {
			continue
		}
		version, ok := parseAgentVersion(output)
		if !ok || best.Executable != "" && !newerAgentVersion(version, bestVersion) {
			continue
		}
		best.Executable, best.Version, bestVersion = path, strings.TrimSpace(output), version
	}
	if best.Executable != "" {
		best.SignedIn = a.checkSignIn(newCLI(a, best.Executable)) == nil
	}
	return best
}

func agentCandidates(a agent) []string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	paths := a.installPaths(home)
	if path := fromLoginShell(a.command()); path != "" {
		paths = append(paths, path)
	}
	return paths
}

// homePaths joins each relative path to home, or returns nothing without a home.
func homePaths(home string, relative ...string) []string {
	if home == "" {
		return nil
	}
	paths := make([]string, len(relative))
	for index, path := range relative {
		paths[index] = filepath.Join(home, path)
	}
	return paths
}

// fromLoginShell asks the user's login shell, which finds installs from
// version managers such as nvm that use a per-version directory.
func fromLoginShell(command string) string {
	shell := os.Getenv("SHELL")
	if !filepath.IsAbs(shell) {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), agentShellTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, shell, "-lc", "command -v "+command).Output()
	if err != nil {
		return ""
	}
	path := strings.TrimSpace(string(output))
	if !filepath.IsAbs(path) {
		return ""
	}
	return path
}

func parseAgentVersion(output string) ([3]int, bool) {
	match := agentVersionPattern.FindStringSubmatch(output)
	if match == nil {
		return [3]int{}, false
	}
	var version [3]int
	for i := range version {
		version[i], _ = strconv.Atoi(match[i+1])
	}
	return version, true
}

func newerAgentVersion(a, b [3]int) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
