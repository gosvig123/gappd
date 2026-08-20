package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"modernc.org/sqlite"
)

const (
	defaultQueryRows  = 50
	maxQueryRows      = 100
	maxQueryBytes     = 48 * 1024
	queryTimeout      = 3 * time.Second
	sqliteLimitLength = 0
)

var forbiddenSQL = regexp.MustCompile(`(?i)\b(insert|update|delete|replace|create|drop|alter|vacuum|attach|detach|pragma|reindex|analyze|load_extension)\b`)

type queryArgs struct {
	SQL     string `json:"sql"`
	Params  []any  `json:"params,omitempty"`
	MaxRows int    `json:"max_rows,omitempty"`
}

type queryResult struct {
	Columns          []string `json:"columns"`
	Rows             [][]any  `json:"rows"`
	Truncated        bool     `json:"truncated"`
	TruncationReason string   `json:"truncation_reason,omitempty"`
	RowLimit         int      `json:"row_limit"`
	ByteLimit        int      `json:"byte_limit"`
}

func executeQuery(parent context.Context, database *sql.DB, args queryArgs) (queryResult, error) {
	if err := validateQueryArgs(args); err != nil {
		return queryResult{}, err
	}
	ctx, cancel := context.WithTimeout(parent, queryTimeout)
	defer cancel()
	conn, err := limitedQueryConnection(ctx, database)
	if err != nil {
		return queryResult{}, err
	}
	defer conn.Close()
	rows, err := conn.QueryContext(ctx, strings.TrimSpace(args.SQL), args.Params...)
	if err != nil {
		return queryResult{}, fmt.Errorf("query database: %w", err)
	}
	defer rows.Close()
	return collectQueryRows(rows, queryRowLimit(args.MaxRows))
}

func limitedQueryConnection(ctx context.Context, database *sql.DB) (*sql.Conn, error) {
	conn, err := database.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire query connection: %w", err)
	}
	if _, err := sqlite.Limit(conn, sqliteLimitLength, maxQueryBytes); err != nil {
		conn.Close()
		return nil, fmt.Errorf("limit query values: %w", err)
	}
	return conn, nil
}

func validateQueryArgs(args queryArgs) error {
	if err := validateReadSQL(args.SQL); err != nil {
		return err
	}
	if args.MaxRows < 0 || args.MaxRows > maxQueryRows {
		return fmt.Errorf("max_rows must be between 1 and %d", maxQueryRows)
	}
	for _, value := range args.Params {
		if !isJSONPrimitive(value) {
			return fmt.Errorf("params must contain JSON primitives only")
		}
	}
	return nil
}

func validateReadSQL(statement string) error {
	trimmed := strings.TrimSpace(statement)
	withoutTrailing := strings.TrimSpace(strings.TrimSuffix(trimmed, ";"))
	if withoutTrailing == "" {
		return fmt.Errorf("sql is required")
	}
	if strings.Contains(withoutTrailing, ";") {
		return fmt.Errorf("only one SQL statement is allowed")
	}
	first := strings.ToLower(strings.Fields(withoutTrailing)[0])
	if first != "select" && first != "with" {
		return fmt.Errorf("only SELECT or WITH queries are allowed")
	}
	if forbiddenSQL.MatchString(withoutTrailing) {
		return fmt.Errorf("SQL contains a forbidden operation")
	}
	return nil
}

func collectQueryRows(rows *sql.Rows, limit int) (queryResult, error) {
	columns, err := rows.Columns()
	if err != nil {
		return queryResult{}, fmt.Errorf("read columns: %w", err)
	}
	result := queryResult{Columns: columns, Rows: make([][]any, 0), RowLimit: limit, ByteLimit: maxQueryBytes}
	if exceedsQueryBytes(result) {
		return queryResult{}, fmt.Errorf("query column metadata exceeds byte limit")
	}
	for rows.Next() {
		if len(result.Rows) >= limit {
			return truncateResult(result, "row_limit"), nil
		}
		row, err := scanQueryRow(rows, len(columns))
		if err != nil {
			return queryResult{}, err
		}
		result.Rows = append(result.Rows, row)
		if exceedsQueryBytes(result) {
			result.Rows = result.Rows[:len(result.Rows)-1]
			return truncateResult(result, "byte_limit"), nil
		}
	}
	return result, rows.Err()
}

func scanQueryRow(rows *sql.Rows, count int) ([]any, error) {
	values := make([]any, count)
	targets := make([]any, count)
	for i := range values {
		targets[i] = &values[i]
	}
	if err := rows.Scan(targets...); err != nil {
		return nil, fmt.Errorf("scan row: %w", err)
	}
	for i, value := range values {
		values[i] = normalizeQueryValue(value)
	}
	return values, nil
}

func normalizeQueryValue(value any) any {
	bytes, ok := value.([]byte)
	if !ok {
		return value
	}
	if utf8.Valid(bytes) {
		return string(bytes)
	}
	return map[string]any{"blob_bytes": len(bytes)}
}

func queryRowLimit(value int) int {
	if value == 0 {
		return defaultQueryRows
	}
	return value
}

func exceedsQueryBytes(result queryResult) bool {
	data, err := json.Marshal(result)
	return err != nil || len(data) > maxQueryBytes
}

func truncateResult(result queryResult, reason string) queryResult {
	result.Truncated = true
	result.TruncationReason = reason
	for exceedsQueryBytes(result) && len(result.Rows) > 0 {
		result.Rows = result.Rows[:len(result.Rows)-1]
	}
	if exceedsQueryBytes(result) {
		result.Columns = nil
	}
	return result
}

func isJSONPrimitive(value any) bool {
	switch value.(type) {
	case nil, bool, string, float64:
		return true
	default:
		return false
	}
}
