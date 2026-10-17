package ai

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/processgroup"
)

const (
	agentCaptureLimit = 256 * 1024
	agentResultLimit  = 2 * 1024 * 1024
	agentErrorDetail  = 300
)

var (
	agentProbeTimeout      = 15 * time.Second
	agentCompletionTimeout = 20 * time.Minute
	agentKillGrace         = 2 * time.Second
)

// agentFallbackPath holds where installers put tools that agent scripts call,
// such as node. A Mac app does not inherit the user's shell PATH.
var agentFallbackPath = []string{"/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"}

// cli runs one agent executable with a minimal environment.
type cli struct {
	name       string
	executable string
	envNames   []string
}

func newCLI(a agent, executable string) cli {
	return cli{name: a.name(), executable: strings.TrimSpace(executable), envNames: a.envNames()}
}

// probe runs a short read-only command and returns its combined output.
func (c cli) probe(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), agentProbeTimeout)
	defer cancel()
	cmd := c.command("", args...)
	output := cappedWriter{remaining: agentCaptureLimit}
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := startAndWait(ctx, cmd); err != nil {
		return output.data.String(), err
	}
	return output.data.String(), nil
}

// run sends prompt on stdin in dir and returns stdout and stderr. The error
// does not quote either, because some agents echo the prompt there; each agent
// adds only detail it knows is safe.
func (c cli) run(ctx context.Context, dir string, args []string, prompt string) ([]byte, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, agentCompletionTimeout)
	defer cancel()
	cmd := c.command(dir, args...)
	cmd.Stdin = strings.NewReader(prompt)
	stdout := cappedWriter{remaining: agentResultLimit + 1}
	stderr := cappedWriter{remaining: agentCaptureLimit}
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := startAndWait(ctx, cmd); err != nil {
		return stdout.data.Bytes(), stderr.data.Bytes(), fmt.Errorf("%s completion failed: %w", c.name, err)
	}
	if stdout.data.Len() > agentResultLimit {
		return nil, nil, fmt.Errorf("%s result exceeds %d bytes", c.name, agentResultLimit)
	}
	return stdout.data.Bytes(), stderr.data.Bytes(), nil
}

func (c cli) command(dir string, args ...string) *exec.Cmd {
	cmd := exec.Command(c.executable, args...)
	cmd.Dir = dir
	cmd.Env = agentEnvironment(os.Environ(), c.envNames, c.executable)
	processgroup.Configure(cmd)
	return cmd
}

// emptyWorkspace makes a private empty directory, so no project files or
// instructions reach the agent.
func emptyWorkspace(name string) (string, func(), error) {
	dir, err := os.MkdirTemp("", "gappd-agent-*")
	if err != nil {
		return "", nil, fmt.Errorf("create %s workspace: %w", name, err)
	}
	cwd := filepath.Join(dir, "workspace")
	if err := os.Mkdir(cwd, 0o700); err != nil {
		os.RemoveAll(dir)
		return "", nil, fmt.Errorf("create empty %s workspace: %w", name, err)
	}
	return cwd, func() { os.RemoveAll(dir) }, nil
}

// errorDetail quotes the end of the first non-empty output for an error.
func errorDetail(outputs ...[]byte) string {
	for _, output := range outputs {
		text := strings.TrimSpace(string(output))
		if text == "" {
			continue
		}
		if len(text) > agentErrorDetail {
			text = "…" + text[len(text)-agentErrorDetail:]
		}
		return ": " + text
	}
	return ""
}

func startAndWait(ctx context.Context, cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start process: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		_ = processgroup.Signal(cmd, syscall.SIGTERM)
	}
	if waitForProcess(done, agentKillGrace) {
		return ctx.Err()
	}
	_ = processgroup.Signal(cmd, syscall.SIGKILL)
	_ = waitForProcess(done, agentKillGrace)
	return ctx.Err()
}

func waitForProcess(done <-chan error, timeout time.Duration) bool {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}

// agentEnvironment keeps only what an agent needs to find its sign-in and
// network settings. API keys and unrelated secrets stay out.
func agentEnvironment(source, extra []string, executable string) []string {
	allowed := make([]string, 0, len(source)+1)
	inheritedPath := ""
	for _, entry := range source {
		name, value, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if name == "PATH" {
			inheritedPath = value
			continue
		}
		if agentEnvironmentAllowed(name, extra) {
			allowed = append(allowed, entry)
		}
	}
	return append(allowed, "PATH="+agentPath(executable, inheritedPath))
}

// agentPath puts the executable's own directories first, so a script agent
// finds the node install it was made with.
func agentPath(executable, inherited string) string {
	dirs := []string{filepath.Dir(executable)}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		dirs = append(dirs, filepath.Dir(resolved))
	}
	dirs = append(dirs, filepath.SplitList(inherited)...)
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".local/bin"))
	}
	dirs = append(dirs, agentFallbackPath...)
	seen := map[string]bool{}
	unique := dirs[:0]
	for _, dir := range dirs {
		if dir != "" && !seen[dir] {
			seen[dir] = true
			unique = append(unique, dir)
		}
	}
	return strings.Join(unique, string(filepath.ListSeparator))
}

func agentEnvironmentAllowed(name string, extra []string) bool {
	if strings.HasPrefix(name, "LC_") {
		return true
	}
	for _, allowed := range extra {
		if name == allowed {
			return true
		}
	}
	switch name {
	case "HOME", "USER", "LOGNAME", "TMPDIR", "LANG",
		"SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
		"http_proxy", "https_proxy", "all_proxy", "no_proxy":
		return true
	default:
		return false
	}
}

// ValidateAgentExecutable reports whether path is an executable file the
// named agent can start.
func ValidateAgentExecutable(id, path string) error {
	return validateExecutable(AgentName(id), path)
}

func validateExecutable(name, path string) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("%s executable path must be absolute", name)
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat %s executable %s: %w", name, path, err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 {
		return fmt.Errorf("%s executable %s is not an executable file", name, path)
	}
	return nil
}

type cappedWriter struct {
	data      bytes.Buffer
	remaining int
}

func (w *cappedWriter) Write(data []byte) (int, error) {
	if w.remaining > 0 {
		keep := len(data)
		if keep > w.remaining {
			keep = w.remaining
		}
		_, _ = w.data.Write(data[:keep])
		w.remaining -= keep
	}
	return len(data), nil
}
