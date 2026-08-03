package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPiBridgeCompletesTextAndJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("Authorization = %q", r.Header.Get("Authorization"))
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if _, structured := request["jsonSchema"]; structured {
			_ = json.NewEncoder(w).Encode(map[string]any{"json": map[string]string{"title": "Decision"}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"text": "Summary"})
	}))
	defer server.Close()
	provider, err := NewPiBridge(server.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	text, err := provider.Complete(context.Background(), CompletionRequest{User: "notes"})
	if err != nil || text != "Summary" {
		t.Fatalf("Complete() = %q, %v", text, err)
	}
	raw, err := provider.CompleteJSON(context.Background(), CompletionRequest{User: "extract", JSONSchema: json.RawMessage(`{"type":"object"}`)})
	if err != nil || string(raw) != `{"title":"Decision"}` {
		t.Fatalf("CompleteJSON() = %s, %v", raw, err)
	}
}

func TestPiBridgeRequiresConfiguration(t *testing.T) {
	_, err := NewPiBridge("", "")
	if !errors.Is(err, ErrConfigurationRequired) {
		t.Fatalf("NewPiBridge() error = %v", err)
	}
}
