package ai

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/gappd-dev/gappd/internal/processgroup"
)

var (
	codexProbeTimeout      = 15 * time.Second
	codexCompletionTimeout = 20 * time.Minute
	codexKillGrace         = 2 * time.Second
)

func (p *CodexExecProvider) probe(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), codexProbeTimeout)
	defer cancel()
	cmd := p.command("", args...)
	var output cappedWriter
	output.remaining = codexCaptureLimit
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := startAndWait(ctx, cmd); err != nil {
		return "", err
	}
	return output.data.String(), nil
}

func (p *CodexExecProvider) runCompletion(ctx context.Context, dir string, args []string, prompt string) error {
	ctx, cancel := context.WithTimeout(ctx, codexCompletionTimeout)
	defer cancel()
	cmd := p.command(dir, args...)
	cmd.Stdin = strings.NewReader(prompt)
	var stdout, stderr cappedWriter
	stdout.remaining, stderr.remaining = codexCaptureLimit, codexCaptureLimit
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := startAndWait(ctx, cmd); err != nil {
		return fmt.Errorf("Codex completion failed: %w", err)
	}
	return nil
}

func (p *CodexExecProvider) command(dir string, args ...string) *exec.Cmd {
	cmd := exec.Command(p.executable, args...)
	cmd.Dir = dir
	cmd.Env = codexEnvironment(os.Environ())
	processgroup.Configure(cmd)
	return cmd
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
	if waitForProcess(done, codexKillGrace) {
		return ctx.Err()
	}
	_ = processgroup.Signal(cmd, syscall.SIGKILL)
	_ = waitForProcess(done, codexKillGrace)
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

func codexEnvironment(source []string) []string {
	allowed := make([]string, 0, len(source))
	for _, entry := range source {
		name, _, found := strings.Cut(entry, "=")
		if found && codexEnvironmentAllowed(name) {
			allowed = append(allowed, entry)
		}
	}
	return allowed
}

func codexEnvironmentAllowed(name string) bool {
	if strings.HasPrefix(name, "LC_") {
		return true
	}
	switch name {
	case "HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "LANG", "CODEX_HOME", "CODEX_CA_CERTIFICATE",
		"SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
		"http_proxy", "https_proxy", "all_proxy", "no_proxy":
		return true
	default:
		return false
	}
}
