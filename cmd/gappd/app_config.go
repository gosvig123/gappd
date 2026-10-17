package main

import (
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/spf13/cobra"
)

func appConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Machine-readable config access",
	}
	cmd.AddCommand(appConfigShowCmd(), appConfigAIStatusCmd(), appConfigFindAgentsCmd(), appConfigAgentModelsCmd(), appConfigUseManagedLocalAICmd(), appConfigUseAgentCmd())
	return cmd
}

func appConfigShowCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "show",
		Short: "Show current config as JSON",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app config show requires --json")
			}
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			return writeJSON(appConfigResponseFor(cfg))
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appConfigAIStatusCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use: "ai-status", Short: "Check the saved AI provider's health",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app config ai-status requires --json")
			}
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			return writeJSON(aiStatusFor(cfg))
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

// aiStatusFor checks a saved agent provider. Local AI health belongs to the
// desktop managed runtime, so it is always reported available here.
func aiStatusFor(cfg config.Config) appprotocol.AIStatusResponse {
	status := appprotocol.AIStatusResponse{AI: appAIConfigFor(cfg), Available: true}
	if !config.IsAgentProvider(cfg.AI.Provider) {
		return status
	}
	if err := ai.ValidateAgentExecutable(cfg.AI.Provider, cfg.AI.AgentExecutable); err != nil {
		return unavailableAIStatus(status, err)
	}
	provider, err := newAgentProvider(cfg.AI)
	if err != nil {
		return unavailableAIStatus(status, err)
	}
	if err := provider.Available(); err != nil {
		return unavailableAIStatus(status, err)
	}
	return status
}

func unavailableAIStatus(status appprotocol.AIStatusResponse, err error) appprotocol.AIStatusResponse {
	message := err.Error()
	status.Available, status.Error = false, &message
	return status
}

func appConfigFindAgentsCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use: "find-agents", Short: "Find the newest install of each supported agent CLI",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app config find-agents requires --json")
			}
			found := findAgents()
			agents := make([]appprotocol.AgentInstall, len(found))
			for index, install := range found {
				agents[index] = appprotocol.AgentInstall{Agent: install.Agent, Executable: install.Executable, Version: install.Version, SignedIn: install.SignedIn}
			}
			return writeJSON(appprotocol.AgentFindResponse{Agents: agents})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func appConfigAgentModelsCmd() *cobra.Command {
	var asJSON bool
	var agent, entered string
	cmd := &cobra.Command{
		Use: "agent-models", Short: "List an installed agent's model catalog",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app config agent-models requires --json")
			}
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			agent = strings.TrimSpace(agent)
			executable := strings.TrimSpace(entered)
			if executable == "" && cfg.AI.Provider == agent {
				executable = cfg.AI.AgentExecutable
			}
			catalog, err := agentCatalog(agent, executable)
			if err != nil {
				name := ai.AgentName(agent)
				return fmt.Errorf("read installed %s model catalog: %w; update %s or open Settings", name, err, name)
			}
			return writeJSON(agentModelsFor(catalog))
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	cmd.Flags().StringVar(&agent, "agent", "", "Agent provider: "+strings.Join(config.AgentProviders, ", "))
	cmd.Flags().StringVar(&entered, "executable", "", "Agent executable to inspect; defaults to the saved one")
	_ = cmd.MarkFlagRequired("agent")
	return cmd
}

func agentModelsFor(catalog ai.AgentCatalog) appprotocol.AgentModelsResponse {
	infos := make([]appprotocol.AgentModelInfo, 0, len(catalog.Models))
	for _, model := range catalog.Models {
		efforts := model.ReasoningEfforts
		if efforts == nil {
			efforts = []string{}
		}
		infos = append(infos, appprotocol.AgentModelInfo{
			ID: model.ID, DisplayName: model.DisplayName,
			DefaultReasoningEffort: model.DefaultReasoningEffort,
			ReasoningEfforts:       efforts, IsDefault: model.IsDefault,
		})
	}
	return appprotocol.AgentModelsResponse{Models: infos, DefaultModel: catalog.DefaultModel, DefaultReasoningEffort: catalog.DefaultReasoningEffort}
}

func appConfigUseManagedLocalAICmd() *cobra.Command {
	var endpoint, model string
	var temperature float64
	cmd := &cobra.Command{
		Use:   "use-managed-local-ai",
		Short: "Persist managed Local AI settings for the desktop app",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadManagedLocalAIRepairConfig()
			if err != nil {
				return err
			}
			if err := applyManagedLocalAI(&cfg, endpoint, model, temperature, cmd.Flags().Changed("temperature")); err != nil {
				return err
			}
			if err := config.Save(cfg); err != nil {
				return fmt.Errorf("save config: %w", err)
			}
			return writeJSON(appConfigResponseFor(cfg))
		},
	}
	cmd.Flags().StringVar(&endpoint, "endpoint", "", "Managed Local AI endpoint")
	cmd.Flags().StringVar(&model, "model", "", "Managed Local AI model")
	cmd.Flags().Float64Var(&temperature, "temperature", 0, "Sampling temperature override")
	return cmd
}

func appConfigUseAgentCmd() *cobra.Command {
	var agent, executable, model, reasoningEffort string
	cmd := &cobra.Command{
		Use: "use-agent", Short: "Use an installed agent CLI for summaries",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			agent = strings.TrimSpace(agent)
			if !config.IsAgentProvider(agent) {
				return fmt.Errorf("unsupported agent %q (supported: %s)", agent, strings.Join(config.AgentProviders, ", "))
			}
			settings := config.AI{Provider: agent, AgentExecutable: strings.TrimSpace(executable), AgentModel: model, AgentReasoningEffort: reasoningEffort}
			provider, err := newAgentProvider(settings)
			if err != nil {
				return err
			}
			if err := provider.Available(); err != nil {
				return fmt.Errorf("preflight %s: %w", ai.AgentName(agent), err)
			}
			applyAgent(&cfg, agent, executable, provider.Selection())
			if err := config.Save(cfg); err != nil {
				return fmt.Errorf("save config: %w", err)
			}
			return writeJSON(appConfigResponseFor(cfg))
		},
	}
	cmd.Flags().StringVar(&agent, "agent", "", "Agent provider: "+strings.Join(config.AgentProviders, ", "))
	cmd.Flags().StringVar(&executable, "executable", "", "Absolute agent executable path")
	cmd.Flags().StringVar(&model, "model", "", "Model from the agent's installed catalog")
	cmd.Flags().StringVar(&reasoningEffort, "reasoning-effort", "", "Reasoning effort supported by that model")
	_ = cmd.MarkFlagRequired("agent")
	_ = cmd.MarkFlagRequired("executable")
	return cmd
}

func applyAgent(cfg *config.Config, agent, executable string, selection ai.AgentSelection) {
	cfg.AI.Provider = agent
	cfg.AI.AgentExecutable = strings.TrimSpace(executable)
	cfg.AI.AgentModel = selection.Model
	cfg.AI.AgentReasoningEffort = selection.Effort
}

func loadAppConfig() (config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return config.Config{}, fmt.Errorf("load config: %w", err)
	}
	return cfg, nil
}

func loadManagedLocalAIRepairConfig() (config.Config, error) {
	cfg, err := config.LoadForManagedLocalAIRepair()
	if err != nil {
		return config.Config{}, fmt.Errorf("load config: %w", err)
	}
	return cfg, nil
}

func applyManagedLocalAI(cfg *config.Config, endpoint, model string, temperature float64, overrideTemp bool) error {
	trimmedEndpoint := strings.TrimSpace(endpoint)
	trimmedModel := strings.TrimSpace(model)
	if trimmedEndpoint == "" {
		return fmt.Errorf("managed Local AI endpoint must not be empty")
	}
	if trimmedModel == "" {
		return fmt.Errorf("managed Local AI model must not be empty")
	}
	cfg.AI.Provider = config.ProviderLlamaCpp
	cfg.AI.Endpoint = trimmedEndpoint
	cfg.AI.Model = trimmedModel
	cfg.AI.Managed = true
	if overrideTemp {
		cfg.AI.Temp = temperature
	}
	return nil
}

func appConfigResponseFor(cfg config.Config) appprotocol.ConfigResponse {
	return appprotocol.ConfigResponse{AI: appAIConfigFor(cfg)}
}

func appAIConfigFor(cfg config.Config) appprotocol.AIConfig {
	return appprotocol.AIConfig{
		Provider: cfg.AI.Provider, Model: cfg.AI.Model, Endpoint: cfg.AI.Endpoint,
		Temperature: cfg.AI.Temp, Managed: cfg.AI.Managed,
		AgentExecutable: cfg.AI.AgentExecutable, AgentModel: cfg.AI.AgentModel,
		AgentReasoningEffort: cfg.AI.AgentReasoningEffort,
	}
}
