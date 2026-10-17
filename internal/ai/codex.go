package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
)

// DefaultCodexModel and DefaultCodexReasoningEffort are the app defaults for
// Installed Codex. They stay valid only when the installed Codex model catalog
// still advertises the pair; discovery failures never fall back to another model.
const (
	DefaultCodexModel           = "gpt-5.6-terra"
	DefaultCodexReasoningEffort = "medium"
)

var codexExecFlags = []string{"--ephemeral", "--sandbox", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--output-last-message", "--output-schema"}

// codexAgent runs `codex exec` read-only, without shell or web tools, and
// without the user's Codex config or rules.
type codexAgent struct{}

func (codexAgent) name() string    { return "Codex" }
func (codexAgent) command() string { return "codex" }

// installPaths include the Codex CLI that ships inside the ChatGPT app.
func (codexAgent) installPaths(home string) []string {
	paths := []string{
		"/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
	}
	return append(paths, homePaths(home,
		"Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
		".local/bin/codex", ".npm-global/bin/codex", ".bun/bin/codex", ".volta/bin/codex",
	)...)
}

func (codexAgent) envNames() []string { return []string{"CODEX_HOME", "CODEX_CA_CERTIFICATE"} }

func (codexAgent) checkCLI(c cli, selection AgentSelection) error {
	rootHelp, err := c.probe("--help")
	if err != nil {
		return fmt.Errorf("inspect Codex capabilities: %w", err)
	}
	execHelp, err := c.probe("exec", "--help")
	if err != nil {
		return fmt.Errorf("inspect Codex exec capabilities: %w", err)
	}
	return validateCodexHelp(rootHelp, execHelp, selection.Model)
}

func validateCodexHelp(rootHelp, execHelp, model string) error {
	if err := requireFlags("Codex", rootHelp, "--config"); err != nil {
		return err
	}
	flags := append([]string{}, codexExecFlags...)
	if model != "" {
		flags = append(flags, "--model")
	}
	return requireFlags("Codex", execHelp, flags...)
}

func (codexAgent) checkSignIn(c cli) error {
	if _, err := c.probe("login", "status"); err != nil {
		return fmt.Errorf("Codex login unavailable: %w; run `%s login`", err, c.executable)
	}
	return nil
}

func (codexAgent) catalog(ctx context.Context, c cli) (AgentCatalog, error) {
	models, err := listCodexModels(ctx, c)
	if err != nil {
		return AgentCatalog{}, err
	}
	return AgentCatalog{Models: models, DefaultModel: DefaultCodexModel, DefaultReasoningEffort: DefaultCodexReasoningEffort}, nil
}

func (codexAgent) complete(ctx context.Context, c cli, selection AgentSelection, req CompletionRequest, schema json.RawMessage) ([]byte, error) {
	cwd, cleanup, err := emptyWorkspace("Codex")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	dir := filepath.Dir(cwd)
	outputPath := filepath.Join(dir, "result")
	if err := createCodexOutput(outputPath); err != nil {
		return nil, err
	}
	instructionsPath := filepath.Join(dir, "instructions.md")
	if err := os.WriteFile(instructionsPath, []byte(req.System), 0o600); err != nil {
		return nil, fmt.Errorf("write Codex instructions: %w", err)
	}
	args, err := codexCompletionArgs(dir, outputPath, instructionsPath, selection, schema)
	if err != nil {
		return nil, err
	}
	if _, _, err := c.run(ctx, cwd, args, req.User); err != nil {
		return nil, err
	}
	return readCodexResult(outputPath)
}

func createCodexOutput(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create Codex result file: %w", err)
	}
	return file.Close()
}

func codexCompletionArgs(dir, outputPath, instructionsPath string, selection AgentSelection, schema json.RawMessage) ([]string, error) {
	args := codexConfigArgs(instructionsPath, selection.Effort)
	args = append(args, "exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--output-last-message", outputPath)
	if len(schema) > 0 {
		path := filepath.Join(dir, "schema.json")
		if err := os.WriteFile(path, schema, 0o600); err != nil {
			return nil, fmt.Errorf("write Codex output schema: %w", err)
		}
		args = append(args, "--output-schema", path)
	}
	if selection.Model != "" {
		args = append(args, "--model", selection.Model)
	}
	return append(args, "-"), nil
}

func codexConfigArgs(instructionsPath, reasoningEffort string) []string {
	args := []string{
		"--config", "model_instructions_file=" + strconv.Quote(instructionsPath),
		"--config", "features.shell_tool=false",
		"--config", `web_search="disabled"`,
	}
	if reasoningEffort != "" {
		args = append(args, "--config", "model_reasoning_effort="+strconv.Quote(reasoningEffort))
	}
	return args
}

func readCodexResult(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read Codex result: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, agentResultLimit+1))
	if err != nil {
		return nil, fmt.Errorf("read Codex result: %w", err)
	}
	if len(data) > agentResultLimit {
		return nil, fmt.Errorf("Codex result exceeds %d bytes", agentResultLimit)
	}
	return bytes.TrimSpace(data), nil
}
