package main

import (
	"reflect"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/appprotocol"
)

func TestArgsExprFormatsOptionalBoolAsSingleCobraToken(t *testing.T) {
	var recordStart appprotocol.CommandSpec
	for _, command := range appprotocol.Commands {
		if command.ID == "record.start" {
			recordStart = command
			break
		}
	}
	got := argsExpr(recordStart.Input, recordStart.Args)
	want := "...(input.speakerLabelsEnabled === undefined ? [] : ['--speaker-labels-enabled=' + String(input.speakerLabelsEnabled)])"
	if !strings.Contains(got, want) {
		t.Fatalf("record.start args = %s, want optional bool expression %s", got, want)
	}
}

func TestArgsExprKeepsOptionalStringsAndNumbersSplit(t *testing.T) {
	type input struct {
		Label *string  `json:"label,omitempty"`
		Limit *float64 `json:"limit,omitempty"`
	}
	args := []appprotocol.CommandArg{
		{Flag: "label", Field: "label", Optional: true, Stringify: true},
		{Flag: "limit", Field: "limit", Optional: true, Stringify: true},
	}
	got := argsExpr(reflect.TypeOf(input{}), args)
	want := "[...(input.label === undefined ? [] : ['--label', String(input.label)]), ...(input.limit === undefined ? [] : ['--limit', String(input.limit)])]"
	if got != want {
		t.Fatalf("argsExpr() = %s, want %s", got, want)
	}
}
