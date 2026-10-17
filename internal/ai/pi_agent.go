package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	piThinkingPattern = regexp.MustCompile(`--thinking <level>\s+Set thinking level:\s*([a-z, ]+)`)
	piFlags           = []string{"--print", "--no-session", "--no-tools", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp", "--no-themes", "--offline", "--system-prompt", "--list-models"}
)

// piAgent runs `pi -p` with the user's Pi extensions, so extension model
// providers stay available, but with no tools, skills, context files, MCP, or
// saved session.
type piAgent struct{}

func (piAgent) name() string    { return "Pi" }
func (piAgent) command() string { return "pi" }

func (piAgent) installPaths(home string) []string {
	paths := homePaths(home, ".local/bin/pi", ".npm-global/bin/pi", ".bun/bin/pi", ".volta/bin/pi")
	return append(paths, "/opt/homebrew/bin/pi", "/usr/local/bin/pi")
}

func (piAgent) envNames() []string { return []string{"PI_CODING_AGENT_DIR", "NODE_EXTRA_CA_CERTS"} }

func (piAgent) checkCLI(c cli, selection AgentSelection) error {
	help, err := c.probe("--help")
	if err != nil {
		return fmt.Errorf("inspect Pi capabilities: %w", err)
	}
	flags := append([]string{}, piFlags...)
	if selection.Model != "" {
		flags = append(flags, "--model")
	}
	if selection.Effort != "" {
		flags = append(flags, "--thinking")
	}
	return requireFlags("Pi", help, flags...)
}

// checkSignIn passes when Pi lists at least one model, because Pi lists only
// models whose provider has credentials.
func (piAgent) checkSignIn(c cli) error {
	output, err := c.probe("--list-models")
	if err == nil && len(parsePiModels(output, nil)) > 0 {
		return nil
	}
	return fmt.Errorf("Pi has no signed-in model provider; run `%s`, sign in with /login, then try again", c.executable)
}

func (piAgent) catalog(_ context.Context, c cli) (AgentCatalog, error) {
	help, err := c.probe("--help")
	if err != nil {
		return AgentCatalog{}, fmt.Errorf("inspect Pi capabilities: %w", err)
	}
	output, err := c.probe("--list-models")
	if err != nil {
		return AgentCatalog{}, fmt.Errorf("list Pi models: %w", err)
	}
	defaults := readPiDefaults()
	models := parsePiModels(output, piThinkingLevels(help))
	if len(models) == 0 {
		return AgentCatalog{}, fmt.Errorf("Pi lists no models; run `%s`, sign in with /login, then try again", c.executable)
	}
	for index := range models {
		models[index].DefaultReasoningEffort = piDefaultEffort(models[index].ReasoningEfforts, defaults.ThinkingLevel)
	}
	selected := findAgentModel(models, defaults.Provider+"/"+defaults.Model)
	if selected == nil {
		selected = &models[0]
	}
	selected.IsDefault = true
	return AgentCatalog{Models: models, DefaultModel: selected.ID, DefaultReasoningEffort: selected.DefaultReasoningEffort}, nil
}

// parsePiModels reads the `pi --list-models` table. Models that think get
// every thinking level; the others have no effort setting.
func parsePiModels(output string, levels []string) []AgentModel {
	var models []AgentModel
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 || fields[0] == "provider" {
			continue
		}
		id := fields[0] + "/" + fields[1]
		model := AgentModel{ID: id, DisplayName: fields[1]}
		if fields[4] == "yes" {
			model.ReasoningEfforts = levels
		}
		models = append(models, model)
	}
	return models
}

func piThinkingLevels(help string) []string {
	match := piThinkingPattern.FindStringSubmatch(help)
	if match == nil {
		return nil
	}
	var levels []string
	for _, level := range strings.Split(match[1], ",") {
		if level = strings.TrimSpace(level); level != "" {
			levels = append(levels, level)
		}
	}
	return levels
}

func piDefaultEffort(levels []string, preferred string) string {
	for _, candidate := range []string{preferred, "medium"} {
		for _, level := range levels {
			if candidate != "" && level == candidate {
				return level
			}
		}
	}
	if len(levels) > 0 {
		return levels[0]
	}
	return ""
}

type piDefaults struct {
	Provider      string `json:"defaultProvider"`
	Model         string `json:"defaultModel"`
	ThinkingLevel string `json:"defaultThinkingLevel"`
}

// readPiDefaults reads the user's default Pi model. A missing or unreadable
// file means no preference.
func readPiDefaults() piDefaults {
	dir := os.Getenv("PI_CODING_AGENT_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return piDefaults{}
		}
		dir = filepath.Join(home, ".pi", "agent")
	}
	var defaults piDefaults
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err == nil {
		_ = json.Unmarshal(data, &defaults)
	}
	return defaults
}

func (piAgent) complete(ctx context.Context, c cli, selection AgentSelection, req CompletionRequest, schema json.RawMessage) ([]byte, error) {
	cwd, cleanup, err := emptyWorkspace("Pi")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	system := req.System
	if len(schema) > 0 {
		system += "\n\nReply with one JSON value only: no prose and no code fences. It must match this JSON Schema:\n" + string(schema)
	}
	args := []string{"--print", "--no-session", "--no-tools", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp", "--no-themes", "--offline", "--system-prompt", system}
	if selection.Model != "" {
		args = append(args, "--model", selection.Model)
	}
	if selection.Effort != "" {
		args = append(args, "--thinking", selection.Effort)
	}
	stdout, stderr, err := c.run(ctx, cwd, args, req.User)
	if err != nil {
		return nil, fmt.Errorf("%w%s", err, errorDetail(stderr, stdout))
	}
	if len(schema) > 0 {
		return jsonFromText(stdout), nil
	}
	return bytes.TrimSpace(stdout), nil
}

// jsonFromText returns the JSON value in a reply that may wrap it in a code
// fence or a sentence. Invalid JSON is returned as is for the caller to reject.
func jsonFromText(text []byte) []byte {
	trimmed := bytes.TrimSpace(text)
	if json.Valid(trimmed) {
		return trimmed
	}
	if fenced, ok := bytes.CutPrefix(trimmed, []byte("```")); ok {
		if newline := bytes.IndexByte(fenced, '\n'); newline >= 0 {
			fenced = fenced[newline+1:]
		}
		fenced = bytes.TrimSpace(bytes.TrimSuffix(bytes.TrimSpace(fenced), []byte("```")))
		if json.Valid(fenced) {
			return fenced
		}
	}
	start, end := bytes.IndexAny(trimmed, "{["), bytes.LastIndexAny(trimmed, "}]")
	if start >= 0 && end > start && json.Valid(trimmed[start:end+1]) {
		return trimmed[start : end+1]
	}
	return trimmed
}
