package ai

import "testing"

func TestParsePiModelsReadsTheTable(t *testing.T) {
	output := "provider       model                       context  max-out  thinking  images\n" +
		"claude-bridge  claude-fable-5              1M       128K     yes       yes   \n" +
		"openai-codex   gpt-5.5-mini                400K     128K     no        yes   \n"
	models := parsePiModels(output, []string{"low", "high"})
	if len(models) != 2 {
		t.Fatalf("models = %+v, want 2", models)
	}
	if models[0].ID != "claude-bridge/claude-fable-5" || len(models[0].ReasoningEfforts) != 2 {
		t.Fatalf("first model = %+v", models[0])
	}
	if models[1].ID != "openai-codex/gpt-5.5-mini" || models[1].ReasoningEfforts != nil {
		t.Fatalf("second model = %+v", models[1])
	}
}

func TestParsePiModelsIgnoresTheSignedOutMessage(t *testing.T) {
	output := "No models available. Use /login to log into a provider via OAuth or API key. See:\n" +
		"  /Users/someone/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/docs/providers.md\n" +
		"  /Users/someone/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/docs/models.md\n"
	if models := parsePiModels(output, nil); len(models) != 0 {
		t.Fatalf("models = %+v, want none", models)
	}
}
