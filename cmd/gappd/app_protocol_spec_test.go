package main

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/gappd-dev/gappd/internal/appprotocol"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

func TestAppCommandSpecMatchesCobraCommands(t *testing.T) {
	root := appCmd()
	assertAppLeavesMatchSpec(t, root)
	for _, spec := range appprotocol.Commands {
		leaf := findAppCommand(t, root, specCommandPath(spec))
		assertFlagsMatchSpec(t, leaf, spec)
		assertArgsMatchSpec(t, leaf, spec)
	}
}

func assertAppLeavesMatchSpec(t *testing.T, root *cobra.Command) {
	t.Helper()
	got := runnableCommandPaths(root)
	want := specCommandPaths()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("app command leaves = %v, want %v", got, want)
	}
}

func findAppCommand(t *testing.T, root *cobra.Command, path []string) *cobra.Command {
	t.Helper()
	leaf, _, err := root.Find(path)
	if err != nil {
		t.Fatalf("find app command %q: %v", strings.Join(path, " "), err)
	}
	return leaf
}

func assertFlagsMatchSpec(t *testing.T, cmd *cobra.Command, spec appprotocol.CommandSpec) {
	t.Helper()
	got := commandFlags(cmd)
	want := specFlags(spec)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s flags = %v, want %v", spec.ID, got, want)
	}
}

func assertArgsMatchSpec(t *testing.T, cmd *cobra.Command, spec appprotocol.CommandSpec) {
	t.Helper()
	count := positionalArgCount(spec)
	if count == 0 || cmd.Args == nil {
		if count == 0 && cmd.Args == nil {
			return
		}
		t.Fatalf("%s positional args mismatch: command validator present=%v, spec count=%d", spec.ID, cmd.Args != nil, count)
	}
	if err := cmd.Args(cmd, strings.Fields(strings.Repeat("x ", count))); err != nil {
		t.Fatalf("%s rejects %d positional args: %v", spec.ID, count, err)
	}
	if err := cmd.Args(cmd, nil); err == nil {
		t.Fatalf("%s accepts zero positional args, want %d", spec.ID, count)
	}
}

func specCommandPaths() []string {
	paths := make([]string, 0, len(appprotocol.Commands))
	for _, spec := range appprotocol.Commands {
		paths = append(paths, strings.Join(specCommandPath(spec), " "))
	}
	sort.Strings(paths)
	return paths
}

func specCommandPath(spec appprotocol.CommandSpec) []string {
	var path []string
	for _, arg := range spec.Args {
		if arg.Literal == "app" || arg.Literal == "" || strings.HasPrefix(arg.Literal, "--") {
			continue
		}
		if arg.Flag != "" || arg.Field != "" {
			continue
		}
		path = append(path, arg.Literal)
	}
	return path
}

func specFlags(spec appprotocol.CommandSpec) []string {
	var flags []string
	for _, arg := range spec.Args {
		switch {
		case arg.Flag != "":
			flags = append(flags, arg.Flag)
		case strings.HasPrefix(arg.Literal, "--"):
			flags = append(flags, strings.TrimPrefix(arg.Literal, "--"))
		}
	}
	sort.Strings(flags)
	return flags
}

func positionalArgCount(spec appprotocol.CommandSpec) int {
	count := 0
	for _, arg := range spec.Args {
		if arg.Field != "" && arg.Flag == "" {
			count++
		}
	}
	return count
}

func commandFlags(cmd *cobra.Command) []string {
	var flags []string
	cmd.LocalFlags().VisitAll(func(flag *pflag.Flag) {
		if flag.Name != "help" {
			flags = append(flags, flag.Name)
		}
	})
	sort.Strings(flags)
	return flags
}

func runnableCommandPaths(root *cobra.Command) []string {
	var paths []string
	collectRunnablePaths(root, nil, &paths)
	sort.Strings(paths)
	return paths
}

func collectRunnablePaths(cmd *cobra.Command, path []string, paths *[]string) {
	next := append(path, cmd.Name())
	if cmd.RunE != nil || cmd.Run != nil {
		*paths = append(*paths, strings.Join(next[1:], " "))
	}
	for _, child := range cmd.Commands() {
		collectRunnablePaths(child, next, paths)
	}
}
