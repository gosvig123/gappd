package main

import (
	"strings"
	"testing"
	"time"
)

func TestParseTimeValidRFC3339(t *testing.T) {
	want := time.Date(2026, time.April, 7, 12, 34, 56, 0, time.UTC)

	got, err := parseTime(want.Format(time.RFC3339))
	if err != nil {
		t.Fatalf("parseTime returned error: %v", err)
	}
	if !got.Equal(want) {
		t.Fatalf("parseTime = %v, want %v", got, want)
	}
}

func TestParseTimeInvalidRFC3339(t *testing.T) {
	_, err := parseTime("not-a-time")
	if err == nil {
		t.Fatal("parseTime error = nil, want error")
	}
	if !strings.Contains(err.Error(), "parse time \"not-a-time\"") {
		t.Fatalf("parseTime error = %q, want parse context", err)
	}
}
