package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/ai"
	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/gappd-dev/gappd/internal/transcribe"
	"github.com/spf13/cobra"
)

func main() {
	if err := rootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "gappd",
		Short: "Terminal-based meeting intelligence",
	}
	root.AddCommand(
		listenCmd(), devicesCmd(), meetingsCmd(), showCmd(),
		setupCmd(), enhanceCmd(), appCmd(),
	)
	return root
}

func loadDeps() (config.Config, *db.DB, *ai.Pipeline, error) {
	cfg, store, err := loadStore()
	if err != nil {
		return cfg, nil, nil, err
	}
	pipeline := ai.NewPipeline(ai.NewOpenAICompat(cfg.AI.Endpoint, cfg.AI.Model), cfg.AI.Temp)
	return cfg, store, pipeline, nil
}

func loadStore() (config.Config, *db.DB, error) {
	cfg, err := config.Load()
	if err != nil {
		return cfg, nil, fmt.Errorf("load config: %w", err)
	}
	store, err := openDB(cfg)
	if err != nil {
		return cfg, nil, err
	}
	return cfg, store, nil
}

func openDB(cfg config.Config) (*db.DB, error) {
	if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	store, err := db.Open(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	if err := store.Init(); err != nil {
		store.Close()
		return nil, err
	}
	return store, nil
}

func cmdContext() context.Context {
	return context.Background()
}

func writeJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func setupCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "setup",
		Short: "Check dependencies and initialize gappd",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			fmt.Print("Checking Local AI... ")
			provider := ai.NewOpenAICompat(cfg.AI.Endpoint, cfg.AI.Model)
			if err := provider.Available(); err != nil {
				fmt.Println("✗")
				return fmt.Errorf("Local AI not reachable: %w", err)
			}
			fmt.Println("✓ connected to", cfg.AI.Endpoint)
			fmt.Println("  model:", cfg.AI.Model)

			fmt.Print("Preparing Apple speech model... ")
			if err := transcribe.PrepareSpeechAsset(cmd.Context()); err != nil {
				fmt.Println("✗")
				return err
			}
			fmt.Println("✓")

			fmt.Print("Initializing database... ")
			store, err := openDB(cfg)
			if err != nil {
				fmt.Println("✗")
				return err
			}
			store.Close()
			fmt.Println("✓", cfg.DBPath)
			fmt.Println("\nReady. Run `gappd listen` to start.")
			return nil
		},
	}
}
