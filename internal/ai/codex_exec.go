package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	codexCaptureLimit = 256 * 1024
	codexResultLimit  = 2 * 1024 * 1024
)

var codexRequiredFlags = []string{"--ephemeral", "--sandbox", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--output-last-message", "--output-schema"}

type CodexExecProvider struct {
	executable string
	model      string
}

func NewCodexExec(executable, model string) *CodexExecProvider {
	return &CodexExecProvider{executable: executable, model: strings.TrimSpace(model)}
}

func (p *CodexExecProvider) Complete(ctx context.Context, req CompletionRequest) (string, error) {
	output, err := p.complete(ctx, req, nil)
	if err == nil && len(output) == 0 {
		return "", fmt.Errorf("Codex returned empty text")
	}
	return string(output), err
}

func (p *CodexExecProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	if len(req.JSONSchema) == 0 || !json.Valid(req.JSONSchema) {
		return nil, fmt.Errorf("Codex completion requires valid JSON schema")
	}
	output, err := p.complete(ctx, req, req.JSONSchema)
	if err != nil {
		return nil, err
	}
	if !json.Valid(output) {
		return nil, fmt.Errorf("Codex returned invalid JSON")
	}
	return json.RawMessage(output), nil
}

func (p *CodexExecProvider) Available() error {
	if err := validateCodexExecutable(p.executable); err != nil {
		return err
	}
	if _, err := p.probe("--version"); err != nil {
		return fmt.Errorf("run Codex --version: %w", err)
	}
	rootHelp, err := p.probe("--help")
	if err != nil {
		return fmt.Errorf("inspect Codex capabilities: %w", err)
	}
	execHelp, err := p.probe("exec", "--help")
	if err != nil {
		return fmt.Errorf("inspect Codex exec capabilities: %w", err)
	}
	if err := validateCodexHelp(rootHelp, execHelp, p.model); err != nil {
		return err
	}
	if _, err := p.probe("login", "status"); err != nil {
		return fmt.Errorf("Codex login unavailable: %w; run `%s login`", err, p.executable)
	}
	return nil
}

func validateCodexHelp(rootHelp, execHelp, model string) error {
	if !strings.Contains(rootHelp, "--config") {
		return fmt.Errorf("Codex executable lacks required --config capability; current Codex CLI/update required")
	}
	flags := append([]string{}, codexRequiredFlags...)
	if model != "" {
		flags = append(flags, "--model")
	}
	for _, flag := range flags {
		if !strings.Contains(execHelp, flag) {
			return fmt.Errorf("Codex executable lacks required %s capability; current Codex CLI/update required", flag)
		}
	}
	return nil
}

func validateCodexExecutable(path string) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("Codex executable path must be absolute")
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat Codex executable %s: %w", path, err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 {
		return fmt.Errorf("Codex executable %s is not an executable file", path)
	}
	return nil
}

func (p *CodexExecProvider) complete(ctx context.Context, req CompletionRequest, schema json.RawMessage) ([]byte, error) {
	dir, err := os.MkdirTemp("", "gappd-codex-*")
	if err != nil {
		return nil, fmt.Errorf("create Codex workspace: %w", err)
	}
	defer os.RemoveAll(dir)
	cwd, outputPath, instructionsPath, err := prepareCodexWorkspace(dir, req.System)
	if err != nil {
		return nil, err
	}
	args, err := p.completionArgs(dir, outputPath, instructionsPath, schema)
	if err != nil {
		return nil, err
	}
	if err := p.runCompletion(ctx, cwd, args, req.User); err != nil {
		return nil, err
	}
	return readCodexResult(outputPath)
}

func prepareCodexWorkspace(dir, instructions string) (string, string, string, error) {
	cwd := filepath.Join(dir, "workspace")
	if err := os.Mkdir(cwd, 0o700); err != nil {
		return "", "", "", fmt.Errorf("create empty Codex workspace: %w", err)
	}
	outputPath := filepath.Join(dir, "result")
	if err := createCodexOutput(outputPath); err != nil {
		return "", "", "", err
	}
	instructionsPath := filepath.Join(dir, "instructions.md")
	if err := os.WriteFile(instructionsPath, []byte(instructions), 0o600); err != nil {
		return "", "", "", fmt.Errorf("write Codex instructions: %w", err)
	}
	return cwd, outputPath, instructionsPath, nil
}

func createCodexOutput(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create Codex result file: %w", err)
	}
	return file.Close()
}

func (p *CodexExecProvider) completionArgs(dir, outputPath, instructionsPath string, schema json.RawMessage) ([]string, error) {
	args := codexConfigArgs(instructionsPath)
	args = append(args, "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--output-last-message", outputPath)
	if len(schema) > 0 {
		path := filepath.Join(dir, "schema.json")
		if err := os.WriteFile(path, schema, 0o600); err != nil {
			return nil, fmt.Errorf("write Codex output schema: %w", err)
		}
		args = append(args, "--output-schema", path)
	}
	if p.model != "" {
		args = append(args, "--model", p.model)
	}
	return append(args, "-"), nil
}

func codexConfigArgs(instructionsPath string) []string {
	return []string{
		"--config", "model_instructions_file=" + strconv.Quote(instructionsPath),
		"--config", "features.shell_tool=false",
		"--config", `web_search="disabled"`,
	}
}
