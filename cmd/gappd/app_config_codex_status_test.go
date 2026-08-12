package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/gappd-dev/gappd/internal/config"
)

const (
	fakeCodexLoggedOutSuffix    = ".logged-out"
	fakeCodexIncompatibleSuffix = ".incompatible"
)

type codexStatusCase struct {
	name      string
	prepare   func(*testing.T, string)
	available bool
	errorText string
}

func TestCodexStatusSkipsProbeForLocalAI(t *testing.T) {
	cfg := config.Config{AI: config.AI{Provider: config.ProviderLlamaCpp, CodexExecutable: "/missing/codex"}}
	status := codexStatusFor(cfg)
	if !status.Available || status.Error != nil || status.AI.Provider != config.ProviderLlamaCpp {
		t.Fatalf("local status = %+v", status)
	}
}

func TestCodexStatusReportsHealthWithoutMutatingConfig(t *testing.T) {
	cases := []codexStatusCase{
		{name: "healthy", available: true},
		{name: "missing", prepare: removeFakeCodex, errorText: "stat Codex executable"},
		{name: "logged out", prepare: markFakeCodex(fakeCodexLoggedOutSuffix), errorText: "Codex login unavailable"},
		{name: "incompatible", prepare: markFakeCodex(fakeCodexIncompatibleSuffix), errorText: "current Codex CLI/update required"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) { assertCodexStatusCase(t, test) })
	}
}

func assertCodexStatusCase(t *testing.T, test codexStatusCase) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	executable := fakeCodexCommand(t)
	saveCodexTestConfig(t, executable)
	before := readConfigBytes(t, home)
	if test.prepare != nil {
		test.prepare(t, executable)
	}
	status := executeCodexStatus(t)
	assertCodexStatus(t, status.Available, status.Error, test)
	if status.AI.Provider != config.ProviderCodexExec || status.AI.CodexExecutable != executable {
		t.Fatalf("status config = %+v", status.AI)
	}
	assertCodexConfigUnchanged(t, home, before, executable)
}

func executeCodexStatus(t *testing.T) appprotocol.CodexStatusResponse {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = writer
	cmd := appConfigCodexStatusCmd()
	cmd.SetArgs([]string{"--json"})
	executeErr := cmd.Execute()
	os.Stdout = original
	_ = writer.Close()
	output, readErr := io.ReadAll(reader)
	_ = reader.Close()
	if executeErr != nil || readErr != nil {
		t.Fatalf("codex-status command = %v, read = %v", executeErr, readErr)
	}
	var status appprotocol.CodexStatusResponse
	if err := json.Unmarshal(output, &status); err != nil {
		t.Fatalf("decode status %q: %v", output, err)
	}
	return status
}

func saveCodexTestConfig(t *testing.T, executable string) {
	t.Helper()
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	applyCodex(&cfg, executable, "gpt-5")
	if err := config.Save(cfg); err != nil {
		t.Fatal(err)
	}
}

func assertCodexStatus(t *testing.T, available bool, statusError *string, test codexStatusCase) {
	t.Helper()
	if available != test.available {
		t.Fatalf("available = %v, want %v", available, test.available)
	}
	if test.errorText == "" && statusError != nil {
		t.Fatalf("error = %q, want nil", *statusError)
	}
	if test.errorText != "" && (statusError == nil || !strings.Contains(*statusError, test.errorText)) {
		t.Fatalf("error = %v, want containing %q", statusError, test.errorText)
	}
}

func assertCodexConfigUnchanged(t *testing.T, home string, before []byte, executable string) {
	t.Helper()
	after := readConfigBytes(t, home)
	if string(after) != string(before) {
		t.Fatalf("config changed during health check\nbefore:\n%s\nafter:\n%s", before, after)
	}
	cfg, err := config.Load()
	if err != nil || cfg.AI.Provider != config.ProviderCodexExec || cfg.AI.CodexExecutable != executable {
		t.Fatalf("saved provider = %+v, %v", cfg.AI, err)
	}
}

func readConfigBytes(t *testing.T, home string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(home, ".gappd", "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func removeFakeCodex(t *testing.T, executable string) {
	t.Helper()
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}
}

func markFakeCodex(suffix string) func(*testing.T, string) {
	return func(t *testing.T, executable string) {
		t.Helper()
		if err := os.WriteFile(executable+suffix, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

const fakeCodexCommandScript = `#!/bin/sh
if [ "$*" = "--version" ]; then echo version; exit 0; fi
if [ "$*" = "--help" ]; then
  [ -f "$0.incompatible" ] && echo outdated || echo --config
  exit 0
fi
if [ "$*" = "exec --help" ]; then
  echo '--ephemeral --sandbox --skip-git-repo-check --ignore-user-config --ignore-rules --output-last-message --output-schema --model'
  exit 0
fi
if [ "$*" = "login status" ]; then
  [ -f "$0.logged-out" ] && exit 1
  echo 'Logged in'; exit 0
fi
exit 9
`

func fakeCodexCommand(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(path, []byte(fakeCodexCommandScript), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}
