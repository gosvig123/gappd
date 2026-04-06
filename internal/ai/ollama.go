package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type OllamaProvider struct {
	endpoint string
	model    string
	client   *http.Client
}

func NewOllama(endpoint, model string) *OllamaProvider {
	return &OllamaProvider{
		endpoint: endpoint,
		model:    model,
		client:   &http.Client{Timeout: 5 * time.Minute},
	}
}

type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaRequest struct {
	Model    string            `json:"model"`
	Messages []ollamaMessage   `json:"messages"`
	Stream   bool              `json:"stream"`
	Format   string            `json:"format,omitempty"`
	Options  ollamaOptions     `json:"options"`
}

type ollamaOptions struct {
	Temperature float64 `json:"temperature"`
}

type ollamaResponse struct {
	Message ollamaMessage `json:"message"`
	Error   string        `json:"error,omitempty"`
}

func (o *OllamaProvider) Complete(ctx context.Context, req CompletionRequest) (string, error) {
	return o.doChat(ctx, req, "")
}

func (o *OllamaProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	raw, err := o.doChat(ctx, req, "json")
	if err != nil {
		return nil, err
	}
	if !json.Valid([]byte(raw)) {
		return nil, fmt.Errorf("ollama returned invalid JSON: %.100s", raw)
	}
	return json.RawMessage(raw), nil
}

func (o *OllamaProvider) Available() error {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(o.endpoint + "/api/tags")
	if err != nil {
		return fmt.Errorf("ollama not running at %s: %w", o.endpoint, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ollama returned status %d", resp.StatusCode)
	}
	return nil
}

func (o *OllamaProvider) doChat(ctx context.Context, req CompletionRequest, format string) (string, error) {
	body, err := o.buildRequest(req, format)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, o.endpoint+"/api/chat", body)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	return o.executeRequest(httpReq)
}

func (o *OllamaProvider) buildRequest(req CompletionRequest, format string) (*bytes.Reader, error) {
	oReq := ollamaRequest{
		Model:  o.model,
		Stream: false,
		Format: format,
		Options: ollamaOptions{
			Temperature: req.Temperature,
		},
		Messages: []ollamaMessage{
			{Role: "system", Content: req.System},
			{Role: "user", Content: req.User},
		},
	}
	data, err := json.Marshal(oReq)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (o *OllamaProvider) executeRequest(httpReq *http.Request) (string, error) {
	resp, err := o.client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("ollama not running at %s: %w", o.endpoint, err)
	}
	defer resp.Body.Close()
	return o.parseResponse(resp)
}

func (o *OllamaProvider) parseResponse(resp *http.Response) (string, error) {
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", o.handleError(resp.StatusCode, data)
	}
	var oResp ollamaResponse
	if err := json.Unmarshal(data, &oResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}
	if oResp.Error != "" {
		return "", fmt.Errorf("ollama error: %s", oResp.Error)
	}
	return oResp.Message.Content, nil
}

func (o *OllamaProvider) handleError(status int, body []byte) error {
	var errResp ollamaResponse
	if err := json.Unmarshal(body, &errResp); err == nil && errResp.Error != "" {
		return fmt.Errorf("ollama error: %s", errResp.Error)
	}
	if status == http.StatusNotFound {
		return fmt.Errorf("model %q not found", o.model)
	}
	return fmt.Errorf("ollama returned status %d: %s", status, string(body))
}
