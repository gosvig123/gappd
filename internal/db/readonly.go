package db

import (
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
)

// OpenReadOnly opens an existing database without initialization or migrations.
func OpenReadOnly(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", readOnlyConnectionString(path))
	if err != nil {
		return nil, fmt.Errorf("open read-only db: %w", err)
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("connect read-only db: %w", err)
	}
	return &DB{Conn: conn, path: path}, nil
}

func readOnlyConnectionString(path string) string {
	query := url.Values{}
	query.Set("mode", "ro")
	query.Add("_pragma", "busy_timeout("+strconv.Itoa(sqliteBusyTimeoutMS)+")")
	query.Add("_pragma", "query_only(1)")
	return (&url.URL{Scheme: "file", Path: path, RawQuery: query.Encode()}).String()
}
