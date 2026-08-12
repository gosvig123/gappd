package ai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCodexExecSeparatesInstructionsAndUserPrompt(t *testing.T) {
	executable := fakeCodex(t)
	provider := NewCodexExec(executable, "")
	result, err := provider.Complete(context.Background(), CompletionRequest{System: "be brief", User: "hello"})
	if err != nil || result != "plain result" {
		t.Fatalf("Complete() = %q, %v", result, err)
	}
	stdin, _ := os.ReadFile(executable + ".stdin")
	instructions, _ := os.ReadFile(executable + ".instructions")
	mode, _ := os.ReadFile(executable + ".instructions-mode")
	if string(stdin) != "hello" || string(instructions) != "be brief" || strings.TrimSpace(string(mode)) != "600" {
		t.Fatalf("stdin=%q instructions=%q mode=%q", stdin, instructions, mode)
	}
}

func TestCodexExecUsesRestrictedConfigAndSchema(t *testing.T) {
	executable := fakeCodex(t)
	provider := NewCodexExec(executable, "gpt-5")
	schema := json.RawMessage(`{"type":"object"}`)
	result, err := provider.CompleteJSON(context.Background(), CompletionRequest{User: "json", JSONSchema: schema})
	if err != nil || string(result) != `{"ok":true}` {
		t.Fatalf("CompleteJSON() = %s, %v", result, err)
	}
	args, _ := os.ReadFile(executable + ".args")
	required := []string{"--config model_instructions_file=", "--config features.shell_tool=false", `--config web_search="disabled"`, "--output-schema", "--model gpt-5", "--sandbox read-only", "--ignore-user-config", "--ignore-rules", " -"}
	for _, value := range required {
		if !strings.Contains(string(args), value) {
			t.Errorf("args missing %q: %s", value, args)
		}
	}
}

func TestCodexExecRejectsEmptyAndInvalidResultsPrivately(t *testing.T) {
	tests := []struct{ marker, want, hidden string }{
		{".empty", "empty text", ""},
		{".invalid", "invalid JSON", "not json"},
	}
	for _, test := range tests {
		t.Run(test.marker, func(t *testing.T) {
			executable := fakeCodex(t)
			writeMarker(t, executable+test.marker)
			var err error
			if test.marker == ".empty" {
				_, err = NewCodexExec(executable, "").Complete(context.Background(), CompletionRequest{})
			} else {
				_, err = NewCodexExec(executable, "").CompleteJSON(context.Background(), CompletionRequest{JSONSchema: json.RawMessage(`{}`)})
			}
			if err == nil || !strings.Contains(err.Error(), test.want) || test.hidden != "" && strings.Contains(err.Error(), test.hidden) {
				t.Fatalf("completion error = %v", err)
			}
		})
	}
}

func TestCodexExecUsesMinimalEnvironment(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "openai-secret")
	t.Setenv("CODEX_API_KEY", "codex-secret")
	t.Setenv("GAPPD_SECRET", "gappd-secret")
	t.Setenv("UNRELATED_SECRET", "other-secret")
	t.Setenv("CODEX_HOME", "/tmp/codex-home")
	t.Setenv("HTTPS_PROXY", "http://proxy.test")
	executable := fakeCodex(t)
	_, err := NewCodexExec(executable, "").Complete(context.Background(), CompletionRequest{User: "env"})
	if err != nil {
		t.Fatal(err)
	}
	environment, _ := os.ReadFile(executable + ".env")
	text := string(environment)
	for _, want := range []string{"CODEX_HOME=/tmp/codex-home", "HTTPS_PROXY=http://proxy.test"} {
		if !strings.Contains(text, want) {
			t.Errorf("environment missing %q", want)
		}
	}
	for _, denied := range []string{"OPENAI_API_KEY", "CODEX_API_KEY", "GAPPD_SECRET", "UNRELATED_SECRET"} {
		if strings.Contains(text, denied) {
			t.Errorf("environment contains %s", denied)
		}
	}
}

func TestCodexExecAvailabilityFailures(t *testing.T) {
	t.Run("capability", func(t *testing.T) {
		executable := fakeCodex(t)
		writeMarker(t, executable+".missing")
		err := NewCodexExec(executable, "").Available()
		if err == nil || !strings.Contains(err.Error(), "current Codex CLI/update required") {
			t.Fatalf("Available() error = %v", err)
		}
	})
	t.Run("login", func(t *testing.T) {
		executable := fakeCodex(t)
		writeMarker(t, executable+".auth")
		err := NewCodexExec(executable, "").Available()
		if err == nil || !strings.Contains(err.Error(), "run `") {
			t.Fatalf("Available() error = %v", err)
		}
	})
}

func TestCodexExecCompletionHasDefaultTimeout(t *testing.T) {
	executable := fakeCodex(t)
	writeMarker(t, executable+".slow")
	previous := codexCompletionTimeout
	codexCompletionTimeout = 100 * time.Millisecond
	t.Cleanup(func() { codexCompletionTimeout = previous })
	_, err := NewCodexExec(executable, "").Complete(context.Background(), CompletionRequest{User: "wait"})
	if err == nil || !strings.Contains(err.Error(), context.DeadlineExceeded.Error()) {
		t.Fatalf("Complete() error=%v", err)
	}
}

func TestCodexExecProbeAndCompletionTimeouts(t *testing.T) {
	executable := fakeCodex(t)
	writeMarker(t, executable+".probe-slow")
	previous := codexProbeTimeout
	codexProbeTimeout = 100 * time.Millisecond
	t.Cleanup(func() { codexProbeTimeout = previous })
	started := time.Now()
	if err := NewCodexExec(executable, "").Available(); err == nil || time.Since(started) > codexKillGrace+time.Second {
		t.Fatalf("Available() error=%v duration=%s", err, time.Since(started))
	}
	os.Remove(executable + ".probe-slow")
	writeMarker(t, executable+".slow")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started = time.Now()
	_, err := NewCodexExec(executable, "").Complete(ctx, CompletionRequest{User: "wait"})
	if err == nil || !strings.Contains(err.Error(), context.DeadlineExceeded.Error()) || time.Since(started) > codexKillGrace+time.Second {
		t.Fatalf("Complete() error=%v duration=%s", err, time.Since(started))
	}
}

const fakeCodexScript = `#!/bin/sh
[ -f "$0.probe-slow" ] && sleep 10
if [ "$*" = "--version" ]; then echo codex-cli-test; exit 0; fi
if [ "$*" = "--help" ]; then echo --config; exit 0; fi
if [ "$*" = "exec --help" ]; then
  flags='--ephemeral --sandbox --skip-git-repo-check --ignore-user-config --output-last-message --output-schema --model'
  [ ! -f "$0.missing" ] && flags="$flags --ignore-rules"
  echo "$flags"; exit 0
fi
if [ "$*" = "login status" ]; then
  [ -f "$0.auth" ] && exit 1
  echo 'Logged in'; exit 0
fi
[ -n "$(find . -mindepth 1 -print -quit)" ] && exit 8
printf '%s\n' "$*" > "$0.args"
env > "$0.env"
cat > "$0.stdin"
out=''; schema=''; instructions=''
while [ "$#" -gt 0 ]; do
  [ "$1" = '--output-last-message' ] && { shift; out="$1"; }
  [ "$1" = '--output-schema' ] && { shift; schema="$1"; }
  [ "$1" = '--config' ] && { shift; case "$1" in model_instructions_file=*) instructions="${1#model_instructions_file=}";; esac; }
  shift
done
instructions="${instructions#\"}"; instructions="${instructions%\"}"
cat "$instructions" > "$0.instructions"
(stat -c %a "$instructions" 2>/dev/null || stat -f %Lp "$instructions") > "$0.instructions-mode"
[ -f "$0.slow" ] && sleep 10
if [ -f "$0.empty" ]; then : > "$out"
elif [ -n "$schema" ]; then
  [ -f "$0.invalid" ] && printf 'not json' > "$out" || printf '{"ok":true}' > "$out"
else printf 'plain result' > "$out"; fi
`

func fakeCodex(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(path, []byte(fakeCodexScript), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeMarker(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
}
