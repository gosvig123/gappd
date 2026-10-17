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
	Managed  bool    `toml:"managed"`
	// AgentExecutable, AgentModel, and AgentReasoningEffort configure the
	// installed agent CLI named by an agent Provider.
	AgentExecutable string `toml:"agent_executable,omitempty"`
	AgentModel      string `toml:"agent_model,omitempty"`
	// AgentReasoningEffort is an effort advertised by the selected agent model.
	// An empty value resolves to the model's catalog default at operation time.
	AgentReasoningEffort string `toml:"agent_reasoning_effort,omitempty"`
	// Legacy Installed Codex keys. Loading moves them to the agent keys, so
	// saving never writes them again.
	LegacyCodexExecutable      string `toml:"codex_executable,omitempty"`
	LegacyCodexModel           string `toml:"codex_model,omitempty"`
	LegacyCodexReasoningEffort string `toml:"codex_reasoning_effort,omitempty"`
}

type Config struct {
	DBPath string `toml:"db_path"`
	AI     AI     `toml:"ai"`
}

const (
	ProviderLlamaCpp = "llamacpp"
	// Agent providers run an installed agent CLI. ProviderPiAgent is not "pi",
	// because "pi" is a legacy name for Local AI.
	ProviderCodexExec  = "codex_exec"
	ProviderClaudeCode = "claude_code"
	ProviderPiAgent    = "pi_agent"
	legacyProviderPi   = "pi"

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
	return load(validate, toleratedUndecodedKey)
}

func LoadForManagedLocalAIRepair() (Config, error) {
	return load(validateManagedLocalAIRepair, toleratedRepairUndecodedKey)
}

func load(validateConfig func(*Config) error, tolerateUnknown func(toml.Key) bool) (Config, error) {
	cfg, err := defaults()
	if err != nil {
		return Config{}, err
	}
	path, err := configPath()
	if err != nil {
		return Config{}, err
	}
	if err := readConfig(path, &cfg, tolerateUnknown); err != nil {
		return Config{}, err
	}
	if err := validateConfig(&cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func readConfig(path string, cfg *Config, tolerateUnknown func(toml.Key) bool) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("stat config: %w", err)
	}
	meta, err := toml.DecodeFile(path, cfg)
	if err != nil {
		return err
	}
	return rejectUnknownConfigKeys(path, meta.Undecoded(), tolerateUnknown)
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
		return fmt.Errorf("unsupported AI provider %q (supported: %s, %s)", cfg.AI.Provider, ProviderLlamaCpp, strings.Join(AgentProviders, ", "))
	}
	if IsAgentProvider(cfg.AI.Provider) && !filepath.IsAbs(cfg.AI.AgentExecutable) {
		return fmt.Errorf("config ai.agent_executable must be an absolute path for provider %s", cfg.AI.Provider)
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
	if cfg.AI.Provider == legacyProviderPi {
		cfg.AI.Provider = ProviderLlamaCpp
	}
	cfg.AI.Model = strings.TrimSpace(cfg.AI.Model)
	cfg.AI.Endpoint = strings.TrimSpace(cfg.AI.Endpoint)
	migrateLegacyCodexKeys(&cfg.AI)
	cfg.AI.AgentExecutable = strings.TrimSpace(cfg.AI.AgentExecutable)
	cfg.AI.AgentModel = strings.TrimSpace(cfg.AI.AgentModel)
	cfg.AI.AgentReasoningEffort = strings.ToLower(strings.TrimSpace(cfg.AI.AgentReasoningEffort))
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

// AgentProviders lists the providers that run an installed agent CLI.
var AgentProviders = []string{ProviderCodexExec, ProviderClaudeCode, ProviderPiAgent}

func IsAgentProvider(provider string) bool {
	for _, agent := range AgentProviders {
		if provider == agent {
			return true
		}
	}
	return false
}

func supportedProvider(provider string) bool {
	return provider == ProviderLlamaCpp || IsAgentProvider(provider)
}

// migrateLegacyCodexKeys moves Installed Codex settings saved before agent
// keys existed. Agent keys win when both are present.
func migrateLegacyCodexKeys(ai *AI) {
	if ai.AgentExecutable == "" && ai.AgentModel == "" && ai.AgentReasoningEffort == "" {
		ai.AgentExecutable, ai.AgentModel, ai.AgentReasoningEffort = ai.LegacyCodexExecutable, ai.LegacyCodexModel, ai.LegacyCodexReasoningEffort
	}
	ai.LegacyCodexExecutable, ai.LegacyCodexModel, ai.LegacyCodexReasoningEffort = "", "", ""
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
