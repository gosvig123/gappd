package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func catalogFixtures() []CodexModel {
	return []CodexModel{
		{ID: DefaultCodexModel, DisplayName: "GPT-5.6-Terra", DefaultReasoningEffort: "medium", ReasoningEfforts: []string{"low", "medium", "high"}},
		{ID: "gpt-5.5", DisplayName: "GPT-5.5", DefaultReasoningEffort: "medium", ReasoningEfforts: []string{"low", "medium", "xhigh"}, IsDefault: true},
	}
}

func TestResolveCodexSelectionUsesRequiredDefaultWhenUnset(t *testing.T) {
	selection, err := ResolveCodexSelection(catalogFixtures(), "", "")
	if err != nil || selection != (CodexSelection{Model: DefaultCodexModel, Effort: DefaultCodexReasoningEffort}) {
		t.Fatalf("ResolveCodexSelection() = %+v, %v", selection, err)
	}
}

func TestResolveCodexSelectionKeepsExplicitModel(t *testing.T) {
	selection, err := ResolveCodexSelection(catalogFixtures(), "gpt-5.5", "xhigh")
	if err != nil || selection != (CodexSelection{Model: "gpt-5.5", Effort: "xhigh"}) {
		t.Fatalf("ResolveCodexSelection() = %+v, %v", selection, err)
	}
}

func TestResolveCodexSelectionUsesCatalogDefaultEffortForExplicitModel(t *testing.T) {
	models := catalogFixtures()
	models[1].DefaultReasoningEffort = "low"
	selection, err := ResolveCodexSelection(models, "gpt-5.5", "")
	if err != nil || selection != (CodexSelection{Model: "gpt-5.5", Effort: "low"}) {
		t.Fatalf("ResolveCodexSelection() = %+v, %v", selection, err)
	}
}

func TestResolveCodexSelectionRejectsUnavailableModel(t *testing.T) {
	selection, err := ResolveCodexSelection(catalogFixtures(), "gpt-retired", "medium")
	if err == nil || selection.Model != "" || !strings.Contains(err.Error(), "not in the installed Codex model catalog") {
		t.Fatalf("ResolveCodexSelection() = %+v, %v", selection, err)
	}
}

func TestResolveCodexSelectionRejectsUnsupportedEffort(t *testing.T) {
	selection, err := ResolveCodexSelection(catalogFixtures(), "gpt-5.5", "ultra")
	if err == nil || selection.Model != "" || !strings.Contains(err.Error(), "does not support reasoning effort") {
		t.Fatalf("ResolveCodexSelection() = %+v, %v", selection, err)
	}
}

func TestResolveCodexSelectionRejectsMissingDefaultPair(t *testing.T) {
	models := []CodexModel{{ID: "gpt-6-astra", DefaultReasoningEffort: "medium", ReasoningEfforts: []string{"medium"}}}
	selection, err := ResolveCodexSelection(models, "", "")
	if err == nil || selection.Model != "" || !strings.Contains(err.Error(), DefaultCodexModel) {
		t.Fatalf("ResolveCodexSelection() = %+v, %v", selection, err)
	}
}

func TestListCodexModelsReadsCatalogAndSkipsHiddenEntries(t *testing.T) {
	models, err := ListCodexModels(context.Background(), fakeCatalogCodex(t, fakeCatalogScript))
	if err != nil {
		t.Fatalf("ListCodexModels() error = %v", err)
	}
	if len(models) != 2 || models[0].ID != DefaultCodexModel || models[1].ID != "gpt-5.6-sol" {
		t.Fatalf("models = %+v", models)
	}
	if models[0].DefaultReasoningEffort != "medium" || strings.Join(models[0].ReasoningEfforts, ",") != "low,medium,high" {
		t.Fatalf("terra = %+v", models[0])
	}
}

func TestListCodexModelsFollowsPagination(t *testing.T) {
	models, err := ListCodexModels(context.Background(), fakeCatalogCodex(t, fakeCatalogPagedScript))
	if err != nil || len(models) != 2 || models[1].ID != "gpt-5.5" {
		t.Fatalf("ListCodexModels() = %+v, %v", models, err)
	}
}

func TestListCodexModelsFailsWithoutCatalogSupport(t *testing.T) {
	executable := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexit 9\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	models, err := ListCodexModels(context.Background(), executable)
	if err == nil || models != nil || !strings.Contains(err.Error(), "initialize Codex model catalog") {
		t.Fatalf("ListCodexModels() = %+v, %v", models, err)
	}
}

func TestListCodexModelsStopsWhenPageLimitExceeded(t *testing.T) {
	if codexCatalogMaxPages > 1000 {
		t.Skip("page limit too large to exercise")
	}
	executable := fakeCatalogCodex(t, fakeCatalogLoopScript)
	models, err := ListCodexModels(context.Background(), executable)
	if err == nil || models != nil || !strings.Contains(err.Error(), "pages") {
		t.Fatalf("ListCodexModels() = %+v, %v", models, err)
	}
}

func TestListCodexModelsKillsStalledAppServer(t *testing.T) {
	previous := codexCatalogTimeout
	codexCatalogTimeout = 200 * time.Millisecond
	t.Cleanup(func() { codexCatalogTimeout = previous })
	executable := fakeCatalogCodex(t, "#!/bin/sh\nsleep 30\n")
	started := time.Now()
	models, err := ListCodexModels(context.Background(), executable)
	if err == nil || models != nil || !strings.Contains(err.Error(), "timed out") || time.Since(started) > 5*time.Second {
		t.Fatalf("ListCodexModels() = %+v, %v after %s", models, err, time.Since(started))
	}
}

func fakeCatalogCodex(t *testing.T, script string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

const fakeCatalogCatalogLine = `{"id":2,"result":{"data":[{"id":"gpt-5.6-terra","model":"gpt-5.6-terra","displayName":"Terra","defaultReasoningEffort":"medium","hidden":false,"isDefault":false,"supportedReasoningEfforts":[{"reasoningEffort":"low","description":"l"},{"reasoningEffort":"medium","description":"m"},{"reasoningEffort":"high","description":"h"}]},{"id":"hidden-model","model":"hidden-model","displayName":"Hidden","defaultReasoningEffort":"medium","hidden":true,"isDefault":false,"supportedReasoningEfforts":[{"reasoningEffort":"medium","description":"m"}]},{"id":"gpt-5.6-sol","model":"gpt-5.6-sol","displayName":"Sol","defaultReasoningEffort":"low","hidden":false,"isDefault":false,"supportedReasoningEfforts":[{"reasoningEffort":"low","description":"l"}]}]}}`

var fakeCatalogScript = `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"method":"ignored/notification"}' '{"id":1,"result":{}}' ;;
    *'"method":"model/list"'*) printf '%s\n' '` + fakeCatalogCatalogLine + `' ;;
  esac
done
`

var fakeCatalogPagedScript = `#!/bin/sh
page=0
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *'"method":"model/list"'*)
      if [ "$page" = "0" ]; then
        page=1
        printf '%s\n' '{"id":2,"result":{"data":[{"id":"gpt-5.6-terra","model":"gpt-5.6-terra","displayName":"Terra","defaultReasoningEffort":"medium","hidden":false,"isDefault":false,"supportedReasoningEfforts":[{"reasoningEffort":"medium","description":"m"}]}],"nextCursor":"page-2"}}'
      else
        printf '%s\n' '{"id":2,"result":{"data":[{"id":"gpt-5.5","model":"gpt-5.5","displayName":"GPT-5.5","defaultReasoningEffort":"medium","hidden":false,"isDefault":false,"supportedReasoningEfforts":[{"reasoningEffort":"medium","description":"m"}]}],"nextCursor":null}}'
      fi
      ;;
  esac
done
`

var fakeCatalogLoopScript = `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *'"method":"model/list"'*) printf '%s\n' '{"id":2,"result":{"data":[],"nextCursor":"again"}}' ;;
  esac
done
`
