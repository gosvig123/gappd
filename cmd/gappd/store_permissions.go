package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/config"
)

const (
	managedDirMode  = 0o700
	managedFileMode = 0o600
	customDirMode   = 0o755
)

func prepareStoreDirectory(dbPath string) error {
	dir := filepath.Dir(dbPath)
	mode := os.FileMode(customDirMode)
	if isManagedDBPath(dbPath) {
		mode = managedDirMode
	}
	if err := os.MkdirAll(dir, mode); err != nil {
		return fmt.Errorf("create db dir: %w", err)
	}
	if isManagedDBPath(dbPath) {
		return chmodExisting(dir, managedDirMode)
	}
	return nil
}

func secureManagedStore(dbPath string) error {
	if !isManagedDBPath(dbPath) {
		return nil
	}
	if err := chmodExisting(filepath.Dir(dbPath), managedDirMode); err != nil {
		return err
	}
	for _, path := range []string{dbPath, dbPath + "-wal", dbPath + "-shm"} {
		if err := chmodExisting(path, managedFileMode); err != nil {
			return err
		}
	}
	return nil
}

func isManagedDBPath(dbPath string) bool {
	dir, err := config.GappdDir()
	if err != nil {
		return false
	}
	return filepath.Clean(dbPath) == filepath.Join(dir, "db.sqlite")
}

func chmodExisting(path string, mode os.FileMode) error {
	if err := os.Chmod(path, mode); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("secure %s: %w", path, err)
	}
	return nil
}
