package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/config"
)

// agent is one installed AI agent CLI that Gappd runs headless to make
// Meeting notes. Each agent lives in its own file; add one to agentIDs and
// agentFor to support another CLI.
type agent interface {
	name() string
	// command is the executable name a login shell finds on PATH.
	command() string
	// installPaths are where the agent's installers put the executable.
	installPaths(home string) []string
	// envNames are extra environment variables the agent may read.
	envNames() []string
	// checkCLI reports whether this install supports every flag Gappd uses.
	checkCLI(c cli, selection AgentSelection) error
	// checkSignIn reports whether the agent can reach a model without user action.
	checkSignIn(c cli) error
	catalog(ctx context.Context, c cli) (AgentCatalog, error)
	// complete returns the final answer. A non-empty schema asks for JSON that matches it.
	complete(ctx context.Context, c cli, selection AgentSelection, req CompletionRequest, schema json.RawMessage) ([]byte, error)
}

// agentIDs lists the supported agents in the order the app shows them.
var agentIDs = []string{config.ProviderCodexExec, config.ProviderClaudeCode, config.ProviderPiAgent}

func agentFor(id string) (agent, error) {
	switch id {
	case config.ProviderCodexExec:
		return codexAgent{}, nil
	case config.ProviderClaudeCode:
		return claudeCodeAgent{}, nil
	case config.ProviderPiAgent:
		return piAgent{}, nil
	default:
		return nil, fmt.Errorf("unsupported agent %q (supported: %s)", id, strings.Join(agentIDs, ", "))
	}
}

// AgentModel is one selectable model from an installed agent's model catalog.
type AgentModel struct {
	ID                     string
	DisplayName            string
	DefaultReasoningEffort string
	// ReasoningEfforts is empty when the model has no reasoning effort setting.
	ReasoningEfforts []string
	IsDefault        bool
}

// AgentCatalog is the installed agent's model catalog and the pair Gappd uses
// when no model was saved.
type AgentCatalog struct {
	Models                 []AgentModel
	DefaultModel           string
	DefaultReasoningEffort string
}

// AgentSelection is the resolved model and reasoning effort for agent calls.
type AgentSelection struct {
	Model  string
	Effort string
}

// ListAgentModels reads the installed agent's model catalog.
func ListAgentModels(ctx context.Context, id, executable string) (AgentCatalog, error) {
	a, err := agentFor(id)
	if err != nil {
		return AgentCatalog{}, err
	}
	if err := validateExecutable(a.name(), executable); err != nil {
		return AgentCatalog{}, err
	}
	return a.catalog(ctx, newCLI(a, executable))
}

// ResolveAgentSelection maps saved configuration onto the installed catalog.
// An unset model resolves to the catalog default pair. An explicit model keeps
// its saved effort, or uses the model's default effort when none was saved.
// Anything the catalog does not advertise is an error, never a silent fallback.
func ResolveAgentSelection(id string, catalog AgentCatalog, savedModel, savedEffort string) (AgentSelection, error) {
	name := AgentName(id)
	model, effort := strings.TrimSpace(savedModel), strings.ToLower(strings.TrimSpace(savedEffort))
	if model == "" {
		selected := findAgentModel(catalog.Models, catalog.DefaultModel)
		if selected == nil || !supportsEffort(selected, catalog.DefaultReasoningEffort) {
			return AgentSelection{}, fmt.Errorf("installed %s model catalog does not advertise %s with %q reasoning effort; choose a model in Settings", name, catalog.DefaultModel, catalog.DefaultReasoningEffort)
		}
		return AgentSelection{Model: catalog.DefaultModel, Effort: catalog.DefaultReasoningEffort}, nil
	}
	selected := findAgentModel(catalog.Models, model)
	if selected == nil {
		return AgentSelection{}, fmt.Errorf("%s model %q is not in the installed %s model catalog; choose a model in Settings", name, model, name)
	}
	if effort == "" {
		return AgentSelection{Model: model, Effort: selected.DefaultReasoningEffort}, nil
	}
	if !supportsEffort(selected, effort) {
		return AgentSelection{}, fmt.Errorf("%s model %q does not support reasoning effort %q; choose a supported effort in Settings", name, model, effort)
	}
	return AgentSelection{Model: model, Effort: effort}, nil
}

func findAgentModel(models []AgentModel, id string) *AgentModel {
	for index := range models {
		if models[index].ID == id {
			return &models[index]
		}
	}
	return nil
}

// supportsEffort accepts an empty effort only for a model without effort levels.
func supportsEffort(model *AgentModel, effort string) bool {
	if len(model.ReasoningEfforts) == 0 {
		return effort == ""
	}
	for _, supported := range model.ReasoningEfforts {
		if supported == effort {
			return true
		}
	}
	return false
}

// AgentName is the display name of an agent provider, such as "Claude Code".
func AgentName(id string) string {
	if a, err := agentFor(id); err == nil {
		return a.name()
	}
	return id
}

// AgentProvider makes completions with one installed agent CLI, one model, and
// one reasoning effort.
type AgentProvider struct {
	agent     agent
	cli       cli
	selection AgentSelection
}

func NewAgentProvider(id, executable string, selection AgentSelection) (*AgentProvider, error) {
	a, err := agentFor(id)
	if err != nil {
		return nil, err
	}
	return &AgentProvider{agent: a, cli: newCLI(a, executable), selection: selection}, nil
}

// Selection reports the model and reasoning effort used for every completion.
func (p *AgentProvider) Selection() AgentSelection {
	return p.selection
}

func (p *AgentProvider) Complete(ctx context.Context, req CompletionRequest) (string, error) {
	output, err := p.agent.complete(ctx, p.cli, p.selection, req, nil)
	if err != nil {
		return "", err
	}
	if len(output) == 0 {
		return "", fmt.Errorf("%s returned empty text", p.agent.name())
	}
	return string(output), nil
}

func (p *AgentProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	if len(req.JSONSchema) == 0 || !json.Valid(req.JSONSchema) {
		return nil, fmt.Errorf("%s completion requires valid JSON schema", p.agent.name())
	}
	output, err := p.agent.complete(ctx, p.cli, p.selection, req, req.JSONSchema)
	if err != nil {
		return nil, err
	}
	if !json.Valid(output) {
		return nil, fmt.Errorf("%s returned invalid JSON", p.agent.name())
	}
	return json.RawMessage(output), nil
}

// Available checks the executable, its version, its flags, and its sign-in.
func (p *AgentProvider) Available() error {
	name := p.agent.name()
	if err := validateExecutable(name, p.cli.executable); err != nil {
		return err
	}
	if _, err := p.cli.probe("--version"); err != nil {
		return fmt.Errorf("run %s --version: %w", name, err)
	}
	if err := p.agent.checkCLI(p.cli, p.selection); err != nil {
		return err
	}
	return p.agent.checkSignIn(p.cli)
}

// requireFlags reports the first flag that help text does not mention.
func requireFlags(name, help string, flags ...string) error {
	for _, flag := range flags {
		if !strings.Contains(help, flag) {
			return fmt.Errorf("%s executable lacks required %s capability; current %s CLI/update required", name, flag, name)
		}
	}
	return nil
}
