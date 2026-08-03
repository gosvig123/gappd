package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	PiBridgeURLEnv   = "GAPPD_PI_BRIDGE_URL"
	PiBridgeTokenEnv = "GAPPD_PI_BRIDGE_TOKEN"
)

var ErrConfigurationRequired = errors.New("AI configuration required")

type PiBridgeProvider struct {
	url    string
	token  string
	client *http.Client
}

type piBridgeResponse struct {
	Text  string          `json:"text"`
	JSON  json.RawMessage `json:"json"`
	Code  string          `json:"code"`
	Error string          `json:"error"`
}

func NewPiBridge(url, token string) (*PiBridgeProvider, error) {
	url, token = strings.TrimRight(strings.TrimSpace(url), "/"), strings.TrimSpace(token)
	if url == "" || token == "" {
		return nil, fmt.Errorf("%w: configure Pi in Gappd settings", ErrConfigurationRequired)
	}
	return &PiBridgeProvider{url: url, token: token, client: &http.Client{Timeout: 20 * time.Minute}}, nil
}

func (p *PiBridgeProvider) Complete(ctx context.Context, req CompletionRequest) (string, error) {
	response, err := p.complete(ctx, req)
	if err != nil {
		return "", err
	}
	if response.Text == "" {
		return "", fmt.Errorf("Pi bridge returned empty text")
	}
	return response.Text, nil
}

func (p *PiBridgeProvider) CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error) {
	response, err := p.complete(ctx, req)
	if err != nil {
		return nil, err
	}
	if !json.Valid(response.JSON) {
		return nil, fmt.Errorf("Pi bridge returned invalid JSON")
	}
	return response.JSON, nil
}

func (p *PiBridgeProvider) Available() error {
	if p.url == "" || p.token == "" {
		return ErrConfigurationRequired
	}
	return nil
}

func (p *PiBridgeProvider) complete(ctx context.Context, input CompletionRequest) (*piBridgeResponse, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("marshal Pi bridge request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.url+"/complete", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create Pi bridge request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+p.token)
	request.Header.Set("Content-Type", "application/json")
	return p.execute(request)
}

func (p *PiBridgeProvider) execute(request *http.Request) (*piBridgeResponse, error) {
	response, err := p.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("complete Pi bridge request: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("read Pi bridge response: %w", err)
	}
	var output piBridgeResponse
	if err := json.Unmarshal(body, &output); err != nil {
		return nil, fmt.Errorf("decode Pi bridge response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, bridgeError(response.StatusCode, output)
	}
	return &output, nil
}

func bridgeError(status int, output piBridgeResponse) error {
	if output.Code == "configuration_required" {
		return fmt.Errorf("%w: %s", ErrConfigurationRequired, output.Error)
	}
	return fmt.Errorf("Pi bridge failed with status %d: %s", status, output.Error)
}
