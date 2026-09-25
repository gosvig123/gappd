package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

const (
	mcpProtocolVersion = "2024-11-05"
	maxToolErrorBytes  = 4 * 1024
	truncationSuffix   = "..."
)

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type toolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type toolResult struct {
	Content []toolContent `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

type toolContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func handleRPC(ctx context.Context, conn *sql.DB, request rpcRequest) *rpcResponse {
	if len(request.ID) == 0 {
		return nil
	}
	switch request.Method {
	case "initialize":
		return rpcSuccess(request.ID, initializeResult())
	case "ping":
		return rpcSuccess(request.ID, map[string]any{})
	case "tools/list":
		return rpcSuccess(request.ID, queryToolList())
	case "tools/call":
		return handleToolCall(ctx, conn, request)
	default:
		return rpcFailure(request.ID, -32601, "method not found")
	}
}

func handleToolCall(ctx context.Context, conn *sql.DB, request rpcRequest) *rpcResponse {
	var call toolCallParams
	if err := json.Unmarshal(request.Params, &call); err != nil {
		return rpcFailure(request.ID, -32602, "invalid tools/call params")
	}
	if call.Name != "query" {
		return rpcFailure(request.ID, -32602, "unknown tool")
	}
	var args queryArgs
	if err := decodeToolArguments(call.Arguments, &args); err != nil {
		return rpcFailure(request.ID, -32602, boundedMCPText(err.Error(), maxToolErrorBytes))
	}
	result, err := executeQuery(ctx, conn, args)
	if err != nil {
		return rpcSuccess(request.ID, errorToolResult(err.Error()))
	}
	return rpcSuccess(request.ID, successToolResult(result))
}

func decodeToolArguments(raw json.RawMessage, target any) error {
	if len(raw) == 0 {
		return fmt.Errorf("query arguments are required")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("invalid query arguments: %w", err)
	}
	return nil
}

func initializeResult() map[string]any {
	return map[string]any{
		"protocolVersion": mcpProtocolVersion,
		"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
		"serverInfo":      map[string]any{"name": "gappd", "version": "1"},
	}
}

func queryToolList() map[string]any {
	primitive := []map[string]any{{"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "null"}}
	properties := map[string]any{
		"sql":      map[string]any{"type": "string", "description": "One SELECT or WITH statement."},
		"params":   map[string]any{"type": "array", "items": map[string]any{"oneOf": primitive}},
		"max_rows": map[string]any{"type": "integer", "minimum": 1, "maximum": maxQueryRows},
	}
	tool := map[string]any{
		"name": "query", "description": "Run a bounded read-only query against the configured Gappd database.",
		"inputSchema": map[string]any{"type": "object", "properties": properties, "required": []string{"sql"}, "additionalProperties": false},
	}
	return map[string]any{"tools": []any{tool}}
}

func successToolResult(result queryResult) toolResult {
	data, err := json.Marshal(result)
	if err != nil {
		return errorToolResult("encode query result: " + err.Error())
	}
	return toolResult{Content: []toolContent{{Type: "text", Text: string(data)}}}
}

func errorToolResult(message string) toolResult {
	text := boundedMCPText(message, maxToolErrorBytes)
	return toolResult{Content: []toolContent{{Type: "text", Text: text}}, IsError: true}
}

func boundedMCPText(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len(value) <= limit {
		return value
	}
	if limit <= len(truncationSuffix) {
		return truncationSuffix[:limit]
	}
	value = value[:limit-len(truncationSuffix)]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value + truncationSuffix
}

func rpcSuccess(id json.RawMessage, result any) *rpcResponse {
	return &rpcResponse{JSONRPC: "2.0", ID: id, Result: result}
}

func rpcFailure(id json.RawMessage, code int, message string) *rpcResponse {
	return &rpcResponse{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: message}}
}
