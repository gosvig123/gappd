package config

import (
	"bytes"
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
	Managed  bool    `toml:"managed"`
}

type Config struct {
	DBPath string `toml:"db_path"`
	AI     AI     `toml:"ai"`
}

const (
	ProviderLlamaCpp = "llamacpp"

	DefaultLlamaCppModel    = "LiquidAI/LFM2-2.6B-Transcript-GGUF"
	DefaultLlamaCppEndpoint = "http://127.0.0.1:11436"
	DefaultAITemperature    = 0.3

	toleratedGoogleConfigTable = "google"
)

func defaults() (Config, error) {
	dir, err := GappdDir()
	if err != nil {
		return Config{}, err
	}
	return Config{
		DBPath: filepath.Join(dir, "db.sqlite"),
		AI: AI{
			Provider: ProviderLlamaCpp,
			Model:    DefaultLlamaCppModel,
			Endpoint: DefaultLlamaCppEndpoint,
			Temp:     DefaultAITemperature,
		},
	}, nil
}

func Load() (Config, error) {
	return load(validate)
}

func LoadForManagedLocalAIRepair() (Config, error) {
	return load(validateManagedLocalAIRepair)
}

func load(validateConfig func(*Config) error) (Config, error) {
	cfg, err := defaults()
	if err != nil {
		return Config{}, err
	}
	path, err := configPath()
	if err != nil {
		return Config{}, err
	}
	if err := readConfig(path, &cfg); err != nil {
		return Config{}, err
	}
	if err := validateConfig(&cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func readConfig(path string, cfg *Config) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("stat config: %w", err)
	}
	meta, err := toml.DecodeFile(path, cfg)
	if err != nil {
		return err
	}
	return rejectUnknownConfigKeys(path, meta.Undecoded())
}

func rejectUnknownConfigKeys(path string, undecoded []toml.Key) error {
	keys := collectUnknownConfigKeys(undecoded)
	if len(keys) == 0 {
		return nil
	}
	return fmt.Errorf("unknown config keys in %s: %s", path, strings.Join(keys, ", "))
}

func collectUnknownConfigKeys(undecoded []toml.Key) []string {
	keys := make([]string, 0, len(undecoded))
	for _, key := range undecoded {
		if !toleratedUndecodedKey(key) {
			keys = append(keys, key.String())
		}
	}
	return keys
}

func toleratedUndecodedKey(key toml.Key) bool {
	name := key.String()
	return name == toleratedGoogleConfigTable || strings.HasPrefix(name, toleratedGoogleConfigTable+".")
}

func Save(cfg Config) error {
	if err := validate(&cfg); err != nil {
		return err
	}
	path, err := configPath()
	if err != nil {
		return err
	}
	data, err := encode(cfg)
	if err != nil {
		return err
	}
	return writeConfig(path, data)
}

func validate(cfg *Config) error {
	if err := normalizeConfig(cfg); err != nil {
		return err
	}
	if !supportedProvider(cfg.AI.Provider) {
		return fmt.Errorf("unsupported AI provider %q (supported: %s)", cfg.AI.Provider, ProviderLlamaCpp)
	}
	if cfg.AI.Model == "" {
		return fmt.Errorf("config ai.model must not be empty")
	}
	if cfg.AI.Endpoint == "" {
		return fmt.Errorf("config ai.endpoint must not be empty")
	}
	return validateTemperature(cfg.AI.Temp)
}

func validateManagedLocalAIRepair(cfg *Config) error {
	if err := normalizeConfig(cfg); err != nil {
		return err
	}
	if err := validateTemperature(cfg.AI.Temp); err != nil {
		cfg.AI.Temp = DefaultAITemperature
	}
	return nil
}

func normalizeConfig(cfg *Config) error {
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
	return nil
}

func validateTemperature(temp float64) error {
	if temp < 0 || temp > 2 {
		return fmt.Errorf("config ai.temperature must be between 0 and 2")
	}
	return nil
}

func supportedProvider(provider string) bool {
	return provider == ProviderLlamaCpp
}

func encode(cfg Config) ([]byte, error) {
	var buf bytes.Buffer
	if err := toml.NewEncoder(&buf).Encode(cfg); err != nil {
		return nil, fmt.Errorf("encode config: %w", err)
	}
	return buf.Bytes(), nil
}

func writeConfig(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "config-*.toml")
	if err != nil {
		return fmt.Errorf("create temp config: %w", err)
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp config: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
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

// GappdDir is the root directory for gappd state (config, db, models, sessions).
func GappdDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".gappd"), nil
}

func configPath() (string, error) {
	dir, err := GappdDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.toml"), nil
}
