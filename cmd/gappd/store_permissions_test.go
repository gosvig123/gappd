package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSecureManagedStoreTightensDefaultPermissions(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir := filepath.Join(home, ".gappd")
	path := filepath.Join(dir, "db.sqlite")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.WriteFile(file, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := secureManagedStore(path); err != nil {
		t.Fatal(err)
	}
	assertMode(t, dir, managedDirMode)
	assertMode(t, path, managedFileMode)
	assertMode(t, path+"-wal", managedFileMode)
	assertMode(t, path+"-shm", managedFileMode)
}

func TestSecureManagedStoreLeavesCustomPathUnchanged(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(t.TempDir(), "shared")
	path := filepath.Join(dir, "custom.sqlite")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := secureManagedStore(path); err != nil {
		t.Fatal(err)
	}
	assertMode(t, dir, 0o755)
	assertMode(t, path, 0o644)
}

func TestPrepareStoreDirectoryTightensExistingManagedDirectory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir := filepath.Join(home, ".gappd")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := prepareStoreDirectory(filepath.Join(dir, "db.sqlite")); err != nil {
		t.Fatal(err)
	}
	assertMode(t, dir, managedDirMode)
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("mode %s = %o, want %o", path, got, want)
	}
}
