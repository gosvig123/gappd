package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

type Audio struct {
	Backend    string `toml:"backend"`
	SampleRate int    `toml:"sample_rate"`
	Channels   int    `toml:"channels"`
}

type Transcription struct {
	Engine   string `toml:"engine"`
	Model    string `toml:"model"`
	Language string `toml:"language"`
	APIKey   string `toml:"api_key"`
	Endpoint string `toml:"endpoint"`
}

type AI struct {
	Provider string  `toml:"provider"`
	Model    string  `toml:"model"`
	APIKey   string  `toml:"api_key"`
	Endpoint string  `toml:"endpoint"`
	Temp     float64 `toml:"temperature"`
}

type CI struct {
	Enabled       bool     `toml:"enabled"`
	PollInterval  string   `toml:"poll_interval"`
	Reminders     bool     `toml:"reminders"`
	WatchedRepos  []string `toml:"watched_repos"`
	NotifyCommand string   `toml:"notify_command"`
}

type Integrations struct {
	CalendarURL string `toml:"calendar_url"`
	SlackToken  string `toml:"slack_token"`
	GitHubToken string `toml:"github_token"`
}

type Config struct {
	DBPath        string        `toml:"db_path"`
	Audio         Audio         `toml:"audio"`
	Transcription Transcription `toml:"transcription"`
	AI            AI            `toml:"ai"`
	CI            CI            `toml:"ci"`
	Integrations  Integrations  `toml:"integrations"`
}

func defaults() (Config, error) {
	dir, err := grnDir()
	if err != nil {
		return Config{}, err
	}
	return Config{
		DBPath: filepath.Join(dir, "db.sqlite"),
		Audio: Audio{
			Backend:    "screencapturekit",
			SampleRate: 16000,
			Channels:   1,
		},
		Transcription: Transcription{
			Engine:   "whisper-local",
			Model:    "base.en",
			Language: "en",
		},
		AI: AI{
			Provider: "ollama",
			Model:    "llama3.1:8b",
			Endpoint: "http://localhost:11434",
			Temp:     0.3,
		},
		CI: CI{
			Enabled:      false,
			PollInterval: "15m",
			Reminders:    true,
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
	cfg.Audio.Backend = strings.TrimSpace(cfg.Audio.Backend)
	cfg.Transcription.Engine = strings.ToLower(strings.TrimSpace(cfg.Transcription.Engine))
	cfg.Transcription.Model = strings.TrimSpace(cfg.Transcription.Model)
	cfg.AI.Provider = strings.ToLower(strings.TrimSpace(cfg.AI.Provider))
	cfg.AI.Model = strings.TrimSpace(cfg.AI.Model)
	cfg.AI.Endpoint = strings.TrimSpace(cfg.AI.Endpoint)
	cfg.CI.PollInterval = strings.TrimSpace(cfg.CI.PollInterval)

	if cfg.DBPath == "" {
		return fmt.Errorf("config db_path must not be empty")
	}
	path, err := normalizeDBPath(cfg.DBPath)
	if err != nil {
		return err
	}
	cfg.DBPath = path
	if cfg.Audio.Backend == "" {
		return fmt.Errorf("config audio.backend must not be empty")
	}
	if cfg.Audio.SampleRate <= 0 {
		return fmt.Errorf("config audio.sample_rate must be greater than 0")
	}
	if cfg.Audio.Channels <= 0 {
		return fmt.Errorf("config audio.channels must be greater than 0")
	}
	if cfg.Transcription.Engine != "whisper-local" {
		return fmt.Errorf("unsupported transcription engine %q (only %q is implemented)", cfg.Transcription.Engine, "whisper-local")
	}
	if cfg.Transcription.Model == "" {
		return fmt.Errorf("config transcription.model must not be empty")
	}
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
	if cfg.CI.PollInterval != "" {
		if _, err := time.ParseDuration(cfg.CI.PollInterval); err != nil {
			return fmt.Errorf("config ci.poll_interval invalid: %w", err)
		}
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
