package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type openAITestServer struct {
	server  *httptest.Server
	request openAIRequest
	status  int
	body    string
}

func newOpenAITestServer(t *testing.T, body string) *openAITestServer {
	t.Helper()
	h := &openAITestServer{status: http.StatusOK, body: body}
	h.server = httptest.NewServer(http.HandlerFunc(h.handle))
	t.Cleanup(h.server.Close)
	return h
}

func (h *openAITestServer) provider() *OpenAICompatProvider {
	return NewOpenAICompat(h.server.URL, "test-model")
}

func (h *openAITestServer) handle(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v1/models" {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": "test-model"}}})
		return
	}
	if r.URL.Path != "/v1/chat/completions" {
		http.NotFound(w, r)
		return
	}
	_ = json.NewDecoder(r.Body).Decode(&h.request)
	w.WriteHeader(h.status)
	_, _ = w.Write([]byte(h.body))
}

func TestOpenAICompatCompleteJSONUsesSchema(t *testing.T) {
	h := newOpenAITestServer(t, `{"choices":[{"message":{"role":"assistant","content":"{\"title\":\"Demo\"}"}}]}`)

	raw, err := h.provider().CompleteJSON(context.Background(), CompletionRequest{System: "sys", User: "user", Temperature: 0.2, JSONSchema: json.RawMessage(`{"type":"object"}`)})
	if err != nil {
		t.Fatalf("CompleteJSON returned error: %v", err)
	}
	if string(raw) != `{"title":"Demo"}` {
		t.Fatalf("raw = %s", raw)
	}
	if h.request.Model != "test-model" || h.request.Temperature != 0.2 {
		t.Fatalf("request = %#v, want model and temperature", h.request)
	}
	if h.request.ResponseFormat == nil {
		t.Fatal("ResponseFormat missing")
	}
}

func TestOpenAICompatCompleteHandlesError(t *testing.T) {
	h := newOpenAITestServer(t, `{"error":{"type":"bad_request","message":"bad schema"}}`)
	h.status = http.StatusBadRequest

	_, err := h.provider().Complete(context.Background(), CompletionRequest{System: "sys", User: "user"})
	if err == nil || !strings.Contains(err.Error(), "llama.cpp complete failed") {
		t.Fatalf("Complete error = %v, want llama.cpp failure", err)
	}
}

func TestOpenAICompatAvailable(t *testing.T) {
	h := newOpenAITestServer(t, ``)
	if err := h.provider().Available(); err != nil {
		t.Fatalf("Available returned error: %v", err)
	}
}
