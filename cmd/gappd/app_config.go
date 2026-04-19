package main

import (
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/config"
	"github.com/spf13/cobra"
)

func appConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Machine-readable config access",
	}
	cmd.AddCommand(appConfigShowCmd(), appConfigUseManagedOllamaCmd(), appConfigResetManagedOllamaCmd())
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

func appConfigUseManagedOllamaCmd() *cobra.Command {
	var endpoint string
	var model string
	var temperature float64
	cmd := &cobra.Command{
		Use:   "use-managed-ollama",
		Short: "Persist managed Ollama settings for the desktop app",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			if err := applyManagedOllama(&cfg, endpoint, model, temperature, cmd.Flags().Changed("temperature")); err != nil {
				return err
			}
			if err := config.Save(cfg); err != nil {
				return fmt.Errorf("save config: %w", err)
			}
			return writeJSON(appConfigResponseFor(cfg))
		},
	}
	cmd.Flags().StringVar(&endpoint, "endpoint", "", "Managed Ollama endpoint")
	cmd.Flags().StringVar(&model, "model", "", "Managed Ollama model tag")
	cmd.Flags().Float64Var(&temperature, "temperature", 0, "Sampling temperature override")
	return cmd
}

func appConfigResetManagedOllamaCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "reset-managed-ollama",
		Short: "Reset managed Ollama settings to defaults",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadAppConfig()
			if err != nil {
				return err
			}
			defaults, err := config.DefaultAI()
			if err != nil {
				return fmt.Errorf("load default config: %w", err)
			}
			cfg.AI = defaults
			if err := config.Save(cfg); err != nil {
				return fmt.Errorf("save config: %w", err)
			}
			return writeJSON(appConfigResponseFor(cfg))
		},
	}
	return cmd
}

func loadAppConfig() (config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return config.Config{}, fmt.Errorf("load config: %w", err)
	}
	return cfg, nil
}

func applyManagedOllama(cfg *config.Config, endpoint, model string, temperature float64, overrideTemp bool) error {
	trimmedEndpoint := strings.TrimSpace(endpoint)
	trimmedModel := strings.TrimSpace(model)
	if trimmedEndpoint == "" {
		return fmt.Errorf("managed Ollama endpoint must not be empty")
	}
	if trimmedModel == "" {
		return fmt.Errorf("managed Ollama model must not be empty")
	}
	cfg.AI.Provider = "ollama"
	cfg.AI.Endpoint = trimmedEndpoint
	cfg.AI.Model = trimmedModel
	cfg.AI.Managed = true
	if overrideTemp {
		cfg.AI.Temp = temperature
	}
	return nil
}

func appConfigResponseFor(cfg config.Config) appConfigResponse {
	return appConfigResponse{
		AI: appAIConfig{
			Provider:    cfg.AI.Provider,
			Model:       cfg.AI.Model,
			Endpoint:    cfg.AI.Endpoint,
			Temperature: cfg.AI.Temp,
			Managed:     cfg.AI.Managed,
		},
	}
}
