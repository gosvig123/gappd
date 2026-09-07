package main

import (
	"github.com/gappd-dev/gappd/internal/recording"
	"reflect"
	"sort"
	"strings"
)

func sortedKeys(in map[string]bool) []string {
	out := make([]string, 0, len(in))
	for key := range in {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func deref(typ reflect.Type) reflect.Type {
	for typ.Kind() == reflect.Pointer || typ.Kind() == reflect.Slice || typ.Kind() == reflect.Array {
		typ = typ.Elem()
	}
	return typ
}

func stringList(items []string) string {
	quoted := make([]string, len(items))
	for i, item := range items {
		quoted[i] = quote(item)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

func eventList(items []recording.EventName) string {
	return stringList(values(items))
}

func union(items []string) string {
	quoted := make([]string, len(items))
	for i, item := range items {
		quoted[i] = quote(item)
	}
	return strings.Join(quoted, " | ")
}

func quote(value string) string {
	return "'" + value + "'"
}

func values[T ~string](in []T) []string {
	out := make([]string, len(in))
	for i, v := range in {
		out[i] = string(v)
	}
	return out
}
