package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/db"
)

func TestValidateReadSQL(t *testing.T) {
	valid := []string{"SELECT id FROM meetings", "WITH ids AS (SELECT 1 AS id) SELECT id FROM ids", "SELECT 1;"}
	for _, statement := range valid {
		if err := validateReadSQL(statement); err != nil {
			t.Errorf("validateReadSQL(%q) = %v", statement, err)
		}
	}
	invalid := []string{"", ";", "UPDATE meetings SET title='x'", "SELECT 1; SELECT 2", "WITH ids AS (SELECT 1) DELETE FROM meetings", "PRAGMA query_only"}
	for _, statement := range invalid {
		if err := validateReadSQL(statement); err == nil {
			t.Errorf("validateReadSQL(%q) succeeded", statement)
		}
	}
}

func TestValidateQueryArgsRejectsInvalidLimitsAndParams(t *testing.T) {
	if err := validateQueryArgs(queryArgs{SQL: "SELECT 1", MaxRows: maxQueryRows + 1}); err == nil {
		t.Fatal("max_rows above hard limit succeeded")
	}
	if err := validateQueryArgs(queryArgs{SQL: "SELECT ?", Params: []any{map[string]any{"nested": true}}}); err == nil {
		t.Fatal("non-primitive parameter succeeded")
	}
}

func TestExecuteQueryAppliesRowAndByteLimits(t *testing.T) {
	store := openMCPTestDB(t)
	defer store.Close()
	rows, err := executeQuery(context.Background(), store.Conn, queryArgs{SQL: "SELECT id FROM meetings ORDER BY id", MaxRows: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !rows.Truncated || rows.TruncationReason != "row_limit" || len(rows.Rows) != 1 {
		t.Fatalf("row-limited result = %+v", rows)
	}
	large, err := executeQuery(context.Background(), store.Conn, queryArgs{SQL: "SELECT ?", Params: []any{strings.Repeat("x", maxQueryBytes)}})
	if err != nil {
		t.Fatal(err)
	}
	if !large.Truncated || large.TruncationReason != "byte_limit" || len(large.Rows) != 0 {
		t.Fatalf("byte-limited result = %+v", large)
	}
}

func TestTruncateResultAlwaysFitsByteLimit(t *testing.T) {
	result := queryResult{
		Columns: []string{strings.Repeat("c", maxQueryBytes)},
		Rows:    [][]any{{"value"}}, RowLimit: 1, ByteLimit: maxQueryBytes,
	}
	truncated := truncateResult(result, "byte_limit")
	data, err := json.Marshal(truncated)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) > maxQueryBytes || len(truncated.Columns) != 0 {
		t.Fatalf("truncated bytes = %d, columns = %d", len(data), len(truncated.Columns))
	}
}

func TestExecuteQueryRejectsOversizedGeneratedValue(t *testing.T) {
	store := openMCPTestDB(t)
	defer store.Close()
	_, err := executeQuery(context.Background(), store.Conn, queryArgs{
		SQL: "SELECT zeroblob(?)", Params: []any{float64(maxQueryBytes * 2)},
	})
	if err == nil {
		t.Fatal("oversized generated value succeeded")
	}
}

func TestExecuteQueryDescribesBinaryBlob(t *testing.T) {
	store := openMCPTestDB(t)
	defer store.Close()
	result, err := executeQuery(context.Background(), store.Conn, queryArgs{SQL: "SELECT x'80ff'"})
	if err != nil {
		t.Fatal(err)
	}
	blob, ok := result.Rows[0][0].(map[string]any)
	if !ok || blob["blob_bytes"] != 2 {
		t.Fatalf("blob value = %#v", result.Rows[0][0])
	}
}

func openMCPTestDB(t *testing.T) *db.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mcp.sqlite")
	seedMCPTestDB(t, path)
	store, err := db.OpenReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func seedMCPTestDB(t *testing.T, path string) {
	t.Helper()
	store, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"one", "two"} {
		if _, err := store.Conn.Exec(`INSERT INTO meetings (id, title, started_at) VALUES (?, ?, '2026-01-01')`, id, id); err != nil {
			t.Fatal(err)
		}
	}
}
