package config

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

func configPath() (string, error) {
	dir, err := GappdDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.toml"), nil
}

func rejectUnknownConfigKeys(path string, undecoded []toml.Key, tolerate func(toml.Key) bool) error {
	keys := collectUnknownConfigKeys(undecoded, tolerate)
	if len(keys) == 0 {
		return nil
	}
	return fmt.Errorf("unknown config keys in %s: %s", path, strings.Join(keys, ", "))
}

func collectUnknownConfigKeys(undecoded []toml.Key, tolerate func(toml.Key) bool) []string {
	keys := make([]string, 0, len(undecoded))
	for _, key := range undecoded {
		if !tolerate(key) {
			keys = append(keys, key.String())
		}
	}
	return keys
}

func toleratedUndecodedKey(key toml.Key) bool {
	name := key.String()
	return name == "ai.pi_provider" || name == "ai.pi_model" || name == toleratedGoogleConfigTable || strings.HasPrefix(name, toleratedGoogleConfigTable+".")
}

func toleratedRepairUndecodedKey(key toml.Key) bool {
	return toleratedUndecodedKey(key) || toleratedLegacyAIKey(key) || toleratedLegacyTable(key)
}

func toleratedLegacyAIKey(key toml.Key) bool {
	switch key.String() {
	case "ai.api_key", "ai.base_url", "ai.max_tokens":
		return true
	default:
		return false
	}
}

func toleratedLegacyTable(key toml.Key) bool {
	name := key.String()
	for _, table := range []string{"audio", "ci", "integrations", "storage", "transcription"} {
		if name == table || strings.HasPrefix(name, table+".") {
			return true
		}
	}
	return false
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
