package main

import (
	"fmt"
	"strings"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/spf13/cobra"
)

func appConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Machine-readable config access",
	}
	cmd.AddCommand(appConfigShowCmd(), appConfigUseManagedLocalAICmd())
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

func appConfigUseManagedLocalAICmd() *cobra.Command {
	var endpoint string
	var model string
	var temperature float64
	cmd := &cobra.Command{
		Use:   "use-managed-local-ai",
		Short: "Persist managed Local AI settings for the desktop app",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := loadAppConfig()
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

func loadAppConfig() (config.Config, error) {
	cfg, err := config.Load()
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
	return appprotocol.ConfigResponse{
		AI: appprotocol.AIConfig{
			Provider:    cfg.AI.Provider,
			Model:       cfg.AI.Model,
			Endpoint:    cfg.AI.Endpoint,
			Temperature: cfg.AI.Temp,
			Managed:     cfg.AI.Managed,
		},
	}
}
