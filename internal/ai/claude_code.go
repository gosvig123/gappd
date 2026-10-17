package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// DefaultClaudeModel and DefaultClaudeReasoningEffort are the app defaults for
// Claude Code. Model aliases always run the newest model of that family.
const (
	DefaultClaudeModel           = "sonnet"
	DefaultClaudeReasoningEffort = "medium"
)

// claudeModels are the model aliases Claude Code accepts. Claude Code has no
// model list command; its --help names the effort levels.
var claudeModels = []AgentModel{
	{ID: "sonnet", DisplayName: "Sonnet (latest)"},
	{ID: "opus", DisplayName: "Opus (latest)"},
	{ID: "fable", DisplayName: "Fable (latest)"},
	{ID: "haiku", DisplayName: "Haiku (latest)"},
}

var (
	claudeEffortPattern = regexp.MustCompile(`--effort <level>\s+Effort level[^(]*\(([a-z, ]+)\)`)
	claudeFlags         = []string{"--print", "--output-format", "--json-schema", "--system-prompt", "--tools", "--no-session-persistence", "--safe-mode", "--strict-mcp-config"}
)

// claudeCodeAgent runs `claude -p` with no tools and with every user
// customization off (--safe-mode), but with the user's normal sign-in.
type claudeCodeAgent struct{}

func (claudeCodeAgent) name() string    { return "Claude Code" }
func (claudeCodeAgent) command() string { return "claude" }

func (claudeCodeAgent) installPaths(home string) []string {
	paths := homePaths(home, ".local/bin/claude", ".claude/local/claude", ".npm-global/bin/claude", ".bun/bin/claude", ".volta/bin/claude")
	return append(paths, "/opt/homebrew/bin/claude", "/usr/local/bin/claude")
}

func (claudeCodeAgent) envNames() []string { return []string{"CLAUDE_CONFIG_DIR"} }

func (claudeCodeAgent) checkCLI(c cli, selection AgentSelection) error {
	help, err := c.probe("--help")
	if err != nil {
		return fmt.Errorf("inspect Claude Code capabilities: %w", err)
	}
	flags := append([]string{}, claudeFlags...)
	if selection.Model != "" {
		flags = append(flags, "--model")
	}
	if selection.Effort != "" {
		flags = append(flags, "--effort")
	}
	return requireFlags("Claude Code", help, flags...)
}

func (claudeCodeAgent) checkSignIn(c cli) error {
	output, err := c.probe("auth", "status", "--json")
	var status struct {
		LoggedIn bool `json:"loggedIn"`
	}
	if err != nil || json.Unmarshal([]byte(output), &status) != nil || !status.LoggedIn {
		return fmt.Errorf("Claude Code is not signed in; run `%s auth login`", c.executable)
	}
	return nil
}

func (claudeCodeAgent) catalog(_ context.Context, c cli) (AgentCatalog, error) {
	help, err := c.probe("--help")
	if err != nil {
		return AgentCatalog{}, fmt.Errorf("inspect Claude Code capabilities: %w", err)
	}
	efforts := claudeEfforts(help)
	if len(efforts) == 0 {
		return AgentCatalog{}, fmt.Errorf("Claude Code executable lacks the --effort capability; current Claude Code CLI/update required")
	}
	models := make([]AgentModel, len(claudeModels))
	for index, model := range claudeModels {
		model.ReasoningEfforts = efforts
		model.DefaultReasoningEffort = DefaultClaudeReasoningEffort
		model.IsDefault = model.ID == DefaultClaudeModel
		models[index] = model
	}
	return AgentCatalog{Models: models, DefaultModel: DefaultClaudeModel, DefaultReasoningEffort: DefaultClaudeReasoningEffort}, nil
}

func claudeEfforts(help string) []string {
	match := claudeEffortPattern.FindStringSubmatch(help)
	if match == nil {
		return nil
	}
	var efforts []string
	for _, effort := range strings.Split(match[1], ",") {
		if effort = strings.TrimSpace(effort); effort != "" {
			efforts = append(efforts, effort)
		}
	}
	return efforts
}

func (claudeCodeAgent) complete(ctx context.Context, c cli, selection AgentSelection, req CompletionRequest, schema json.RawMessage) ([]byte, error) {
	cwd, cleanup, err := emptyWorkspace("Claude Code")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	args := []string{"--print", "--output-format", "json", "--tools", "", "--no-session-persistence", "--safe-mode", "--strict-mcp-config", "--system-prompt", req.System}
	if selection.Model != "" {
		args = append(args, "--model", selection.Model)
	}
	if selection.Effort != "" {
		args = append(args, "--effort", selection.Effort)
	}
	if len(schema) > 0 {
		args = append(args, "--json-schema", string(schema))
	}
	stdout, _, runErr := c.run(ctx, cwd, args, req.User)
	message, parseErr := claudeResult(stdout)
	if message != nil && (message.IsError || message.Subtype != "success") {
		return nil, fmt.Errorf("Claude Code completion failed (%s)%s", message.Subtype, errorDetail([]byte(message.Result)))
	}
	if runErr != nil {
		return nil, runErr
	}
	if parseErr != nil {
		return nil, parseErr
	}
	if len(schema) > 0 && len(message.StructuredOutput) > 0 && string(message.StructuredOutput) != "null" {
		return message.StructuredOutput, nil
	}
	return []byte(strings.TrimSpace(message.Result)), nil
}

type claudeMessage struct {
	Type             string          `json:"type"`
	Subtype          string          `json:"subtype"`
	IsError          bool            `json:"is_error"`
	Result           string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
}

// claudeResult finds the result message. The JSON output is one result
// object, or a list of messages that ends with one.
func claudeResult(stdout []byte) (*claudeMessage, error) {
	trimmed := bytes.TrimSpace(stdout)
	var messages []claudeMessage
	if bytes.HasPrefix(trimmed, []byte("[")) {
		if err := json.Unmarshal(trimmed, &messages); err != nil {
			return nil, fmt.Errorf("Claude Code returned unreadable output")
		}
	} else {
		var message claudeMessage
		if err := json.Unmarshal(trimmed, &message); err != nil {
			return nil, fmt.Errorf("Claude Code returned unreadable output")
		}
		messages = []claudeMessage{message}
	}
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Type == "result" {
			return &messages[index], nil
		}
	}
	return nil, fmt.Errorf("Claude Code output had no result")
}
