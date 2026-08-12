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
	cmd.AddCommand(appConfigShowCmd(), appConfigCodexStatusCmd(), appConfigUseManagedLocalAICmd(), appConfigUseCodexCmd())
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

func appConfigCodexStatusCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use: "codex-status", Short: "Check saved Installed Codex health",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !asJSON {
				return fmt.Errorf("app config codex-status requires --json")
			}
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			return writeJSON(codexStatusFor(cfg))
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func codexStatusFor(cfg config.Config) appprotocol.CodexStatusResponse {
	status := appprotocol.CodexStatusResponse{AI: appAIConfigFor(cfg), Available: true}
	if cfg.AI.Provider != config.ProviderCodexExec {
		return status
	}
	if err := ai.NewCodexExec(cfg.AI.CodexExecutable, cfg.AI.CodexModel).Available(); err != nil {
		message := err.Error()
		status.Available, status.Error = false, &message
	}
	return status
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

func appConfigUseCodexCmd() *cobra.Command {
	var executable, model string
	cmd := &cobra.Command{
		Use: "use-codex", Short: "Use an installed Codex CLI for summaries",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			applyCodex(&cfg, executable, model)
			if err := ai.NewCodexExec(cfg.AI.CodexExecutable, cfg.AI.CodexModel).Available(); err != nil {
				return fmt.Errorf("preflight Installed Codex: %w", err)
			}
			if err := config.Save(cfg); err != nil {
				return fmt.Errorf("save config: %w", err)
			}
			return writeJSON(appConfigResponseFor(cfg))
		},
	}
	cmd.Flags().StringVar(&executable, "executable", "", "Absolute Codex executable path")
	cmd.Flags().StringVar(&model, "model", "", "Optional Codex model")
	_ = cmd.MarkFlagRequired("executable")
	return cmd
}

func applyCodex(cfg *config.Config, executable, model string) {
	cfg.AI.Provider = config.ProviderCodexExec
	cfg.AI.CodexExecutable = strings.TrimSpace(executable)
	cfg.AI.CodexModel = strings.TrimSpace(model)
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
		CodexExecutable: cfg.AI.CodexExecutable, CodexModel: cfg.AI.CodexModel,
	}
}
