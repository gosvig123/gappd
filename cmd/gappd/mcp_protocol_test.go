package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestServeMCPInitializeListAndCall(t *testing.T) {
	store := openMCPTestDB(t)
	defer store.Close()
	input := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query","arguments":{"sql":"SELECT title FROM meetings WHERE id = ?","params":["one"]}}}`,
		`{"jsonrpc":"2.0","id":4,"method":"ping"}`,
	}, "\n")
	var output bytes.Buffer
	if err := serveMCP(context.Background(), strings.NewReader(input), &output, store.Conn); err != nil {
		t.Fatal(err)
	}
	responses := decodeMCPResponses(t, output.Bytes())
	if len(responses) != 4 {
		t.Fatalf("responses = %d, want 4: %s", len(responses), output.String())
	}
	assertInitializeResponse(t, responses[0])
	assertToolListResponse(t, responses[1])
	assertQueryResponse(t, responses[2])
	if responses[3].Error != nil {
		t.Fatalf("ping error = %+v", responses[3].Error)
	}
}

func TestMCPCommandRejectsWritableMode(t *testing.T) {
	cmd := mcpCmd()
	cmd.SetArgs([]string{"--read-only=false"})
	if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "only supports read-only") {
		t.Fatalf("writable MCP error = %v", err)
	}
}

func TestServeMCPReturnsToolAndProtocolErrors(t *testing.T) {
	store := openMCPTestDB(t)
	defer store.Close()
	input := "not json\n" + `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query","arguments":{"sql":"DELETE FROM meetings"}}}`
	var output bytes.Buffer
	if err := serveMCP(context.Background(), strings.NewReader(input), &output, store.Conn); err != nil {
		t.Fatal(err)
	}
	responses := decodeMCPResponses(t, output.Bytes())
	if responses[0].Error == nil || responses[0].Error.Code != -32700 {
		t.Fatalf("parse response = %+v", responses[0])
	}
	result, ok := responses[1].Result.(map[string]any)
	if !ok || result["isError"] != true {
		t.Fatalf("tool error response = %#v", responses[1].Result)
	}
}

func TestErrorToolResultBoundsText(t *testing.T) {
	result := errorToolResult(strings.Repeat("ø", maxToolErrorBytes))
	text := result.Content[0].Text
	if len(text) > maxToolErrorBytes {
		t.Fatalf("error text bytes = %d, want <= %d", len(text), maxToolErrorBytes)
	}
	if !strings.HasSuffix(text, truncationSuffix) {
		t.Fatalf("error text was not truncated: %q", text)
	}
}

func decodeMCPResponses(t *testing.T, data []byte) []rpcResponse {
	t.Helper()
	var responses []rpcResponse
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		var response rpcResponse
		if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		responses = append(responses, response)
	}
	return responses
}

func assertInitializeResponse(t *testing.T, response rpcResponse) {
	t.Helper()
	result := response.Result.(map[string]any)
	if result["protocolVersion"] != mcpProtocolVersion {
		t.Fatalf("initialize result = %#v", result)
	}
}

func assertToolListResponse(t *testing.T, response rpcResponse) {
	t.Helper()
	result := response.Result.(map[string]any)
	tools := result["tools"].([]any)
	tool := tools[0].(map[string]any)
	if len(tools) != 1 || tool["name"] != "query" {
		t.Fatalf("tools result = %#v", result)
	}
}

func assertQueryResponse(t *testing.T, response rpcResponse) {
	t.Helper()
	result := response.Result.(map[string]any)
	content := result["content"].([]any)[0].(map[string]any)
	var query queryResult
	if err := json.Unmarshal([]byte(content["text"].(string)), &query); err != nil {
		t.Fatal(err)
	}
	if got := query.Rows[0][0]; got != "one" {
		t.Fatalf("query value = %#v", got)
	}
}
