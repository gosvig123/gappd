package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"

	"github.com/gappd-dev/gappd/internal/config"
	"github.com/gappd-dev/gappd/internal/db"
	"github.com/spf13/cobra"
)

const maxMCPMessageBytes = 1024 * 1024

func mcpCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mcp",
		Short: "Serve read-only Gappd database queries over stdio MCP",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runMCPCommand(cmd)
		},
	}
	cmd.Flags().Bool("read-only", true, "Open the Gappd database read-only")
	return cmd
}

func runMCPCommand(cmd *cobra.Command) error {
	readOnly, err := cmd.Flags().GetBool("read-only")
	if err != nil {
		return fmt.Errorf("read MCP mode: %w", err)
	}
	if !readOnly {
		return fmt.Errorf("mcp only supports read-only mode")
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	if err := secureManagedStore(cfg.DBPath); err != nil {
		return err
	}
	store, err := db.OpenReadOnly(cfg.DBPath)
	if err != nil {
		return err
	}
	defer store.Close()
	return serveMCP(cmd.Context(), cmd.InOrStdin(), cmd.OutOrStdout(), store.Conn)
}

func serveMCP(ctx context.Context, input io.Reader, output io.Writer, conn *sql.DB) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), maxMCPMessageBytes)
	encoder := json.NewEncoder(output)
	for scanner.Scan() {
		response, err := processMCPLine(ctx, conn, scanner.Bytes())
		if err != nil {
			return err
		}
		if response != nil {
			if err := encoder.Encode(response); err != nil {
				return fmt.Errorf("write MCP response: %w", err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read MCP request: %w", err)
	}
	return nil
}

func processMCPLine(ctx context.Context, conn *sql.DB, line []byte) (*rpcResponse, error) {
	var request rpcRequest
	if err := json.Unmarshal(line, &request); err != nil {
		return rpcFailure(nil, -32700, "parse error"), nil
	}
	if request.JSONRPC != "2.0" || request.Method == "" {
		return rpcFailure(request.ID, -32600, "invalid request"), nil
	}
	return handleRPC(ctx, conn, request), nil
}
