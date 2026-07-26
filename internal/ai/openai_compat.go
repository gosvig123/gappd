package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type OpenAICompatProvider struct {
	endpoint string
	model    string
	client   *http.Client
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIRequest struct {
	Model          string          `json:"model"`
	Messages       []openAIMessage `json:"messages"`
	Temperature    float64         `json:"temperature"`
	Stream         bool            `json:"stream"`
	ResponseFormat any             `json:"response_format,omitempty"`
	MaxTokens      int             `json:"max_tokens,omitempty"`
}

type openAIResponse struct {
	Choices []struct {
		Message openAIMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

func NewOpenAICompat(endpoint, model string) *OpenAICompatProvider {
	return &OpenAICompatProvider{endpoint: strings.TrimRight(endpoint, "/"), model: model, client: &http.Client{Timeout: 20 * time.Minute}}
}

func (p *OpenAICompatProvider) Complete(ctx context.Context, req CompletionRequest) (string, error) {
	return p.doChat(ctx, req, nil)
}

func (p *OpenAICompatProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	raw, err := p.doChat(ctx, req, p.responseFormat(req.JSONSchema))
	if err != nil {
		return nil, err
	}
	if !json.Valid([]byte(raw)) {
		return nil, fmt.Errorf("llama.cpp returned invalid JSON: %.100s", raw)
	}
	return json.RawMessage(raw), nil
}

func (p *OpenAICompatProvider) Available() error {
	resp, err := p.client.Get(p.endpoint + "/v1/models")
	if err != nil {
		return fmt.Errorf("check llama.cpp availability at %s for model %s: %w; start Local AI setup, then retry", p.endpoint, p.model, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("check llama.cpp availability at %s for model %s: status %d: %.200s; restart Local AI setup", p.endpoint, p.model, resp.StatusCode, body)
	}
	return nil
}

func (p *OpenAICompatProvider) doChat(ctx context.Context, req CompletionRequest, responseFormat any) (string, error) {
	body, err := p.buildRequest(req, responseFormat)
	if err != nil {
		return "", fmt.Errorf("marshal llama.cpp request for %s/%s: %w", p.endpoint, p.model, err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint+"/v1/chat/completions", body)
	if err != nil {
		return "", fmt.Errorf("create llama.cpp request for %s/%s: %w", p.endpoint, p.model, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	return p.executeRequest(httpReq)
}

func (p *OpenAICompatProvider) buildRequest(req CompletionRequest, responseFormat any) (*bytes.Reader, error) {
	data, err := json.Marshal(openAIRequest{Model: p.model, Stream: false, Temperature: req.Temperature, ResponseFormat: responseFormat, MaxTokens: req.MaxTokens, Messages: []openAIMessage{{Role: "system", Content: req.System}, {Role: "user", Content: req.User}}})
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (p *OpenAICompatProvider) executeRequest(httpReq *http.Request) (string, error) {
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("complete llama.cpp request at %s for model %s: %w; ensure Local AI is running", p.endpoint, p.model, err)
	}
	defer resp.Body.Close()
	return p.parseResponse(resp)
}

func (p *OpenAICompatProvider) parseResponse(resp *http.Response) (string, error) {
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read llama.cpp response from %s for model %s: %w", p.endpoint, p.model, err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", p.handleError(resp.StatusCode, data)
	}
	return p.parseOK(data)
}

func (p *OpenAICompatProvider) parseOK(data []byte) (string, error) {
	var out openAIResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("unmarshal llama.cpp response from %s for model %s: %w", p.endpoint, p.model, err)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("llama.cpp response from %s for model %s had no choices", p.endpoint, p.model)
	}
	return out.Choices[0].Message.Content, nil
}

func (p *OpenAICompatProvider) handleError(status int, body []byte) error {
	var out openAIResponse
	if err := json.Unmarshal(body, &out); err == nil && out.Error != nil {
		return fmt.Errorf("llama.cpp complete failed at %s for model %s: status %d %s: %s; restart Local AI setup", p.endpoint, p.model, status, out.Error.Type, out.Error.Message)
	}
	return fmt.Errorf("llama.cpp complete failed at %s for model %s: status %d: %.200s; restart Local AI setup", p.endpoint, p.model, status, body)
}

func (p *OpenAICompatProvider) responseFormat(schema json.RawMessage) any {
	if len(schema) == 0 {
		return map[string]string{"type": "json_object"}
	}
	return map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "extraction", "strict": true, "schema": schema}}
}
