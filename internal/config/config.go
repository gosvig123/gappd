package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

type AI struct {
	Provider string  `toml:"provider"`
	Model    string  `toml:"model"`
	Endpoint string  `toml:"endpoint"`
	Temp     float64 `toml:"temperature"`
}

type Config struct {
	DBPath string `toml:"db_path"`
	AI     AI     `toml:"ai"`
}

func defaults() (Config, error) {
	dir, err := grnDir()
	if err != nil {
		return Config{}, err
	}
	return Config{
		DBPath: filepath.Join(dir, "db.sqlite"),
		AI: AI{
			Provider: "ollama",
			Model:    "llama3.1:8b",
			Endpoint: "http://localhost:11434",
			Temp:     0.3,
		},
	}, nil
}

func Load() (Config, error) {
	cfg, err := defaults()
	if err != nil {
		return Config{}, err
	}

	dir, err := grnDir()
	if err != nil {
		return Config{}, err
	}
	path := filepath.Join(dir, "config.toml")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := validate(&cfg); err != nil {
			return Config{}, err
		}
		return cfg, nil
	} else if err != nil {
		return Config{}, fmt.Errorf("stat config: %w", err)
	}

	meta, err := toml.DecodeFile(path, &cfg)
	if err != nil {
		return Config{}, err
	}
	if undecoded := meta.Undecoded(); len(undecoded) > 0 {
		keys := make([]string, 0, len(undecoded))
		for _, key := range undecoded {
			keys = append(keys, key.String())
		}
		return Config{}, fmt.Errorf("unknown config keys in %s: %s", path, strings.Join(keys, ", "))
	}
	if err := validate(&cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func validate(cfg *Config) error {
	cfg.DBPath = strings.TrimSpace(cfg.DBPath)
	cfg.AI.Provider = strings.ToLower(strings.TrimSpace(cfg.AI.Provider))
	cfg.AI.Model = strings.TrimSpace(cfg.AI.Model)
	cfg.AI.Endpoint = strings.TrimSpace(cfg.AI.Endpoint)

	if cfg.DBPath == "" {
		return fmt.Errorf("config db_path must not be empty")
	}
	path, err := normalizeDBPath(cfg.DBPath)
	if err != nil {
		return err
	}
	cfg.DBPath = path
	if cfg.AI.Provider != "ollama" {
		return fmt.Errorf("unsupported AI provider %q (only %q is implemented)", cfg.AI.Provider, "ollama")
	}
	if cfg.AI.Model == "" {
		return fmt.Errorf("config ai.model must not be empty")
	}
	if cfg.AI.Endpoint == "" {
		return fmt.Errorf("config ai.endpoint must not be empty")
	}
	if cfg.AI.Temp < 0 || cfg.AI.Temp > 2 {
		return fmt.Errorf("config ai.temperature must be between 0 and 2")
	}
	return nil
}

func normalizeDBPath(path string) (string, error) {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory for db_path: %w", err)
		}
		if path == "~" {
			return filepath.Clean(home), nil
		}
		path = filepath.Join(home, path[2:])
	} else if strings.HasPrefix(path, "~") {
		return "", fmt.Errorf("config db_path %q uses unsupported home shorthand", path)
	}
	return filepath.Clean(path), nil
}

func grnDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".grn"), nil
}
