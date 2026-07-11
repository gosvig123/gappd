package audioartifact

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gappd-dev/gappd/internal/config"
)

// DeleteSession safely removes a capture session beneath GappdDir/sessions.
func DeleteSession(sessionDir string) error {
	root, err := config.GappdDir()
	if err != nil {
		return fmt.Errorf("resolve artifact root: %w", err)
	}
	return DeleteSessionUnder(root, sessionDir)
}

func DeleteSessionUnder(gappdRoot, sessionDir string) error {
	cleaned, err := filepath.Abs(sessionDir)
	if err != nil {
		return fmt.Errorf("resolve artifact path %q: %w", sessionDir, err)
	}
	sessionsRoot := filepath.Join(gappdRoot, "sessions")
	ok, err := pathInside(cleaned, sessionsRoot)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("skip artifact delete %s: outside %s", cleaned, sessionsRoot)
	}
	if err := os.RemoveAll(cleaned); err != nil {
		return fmt.Errorf("delete artifacts %s: %w", cleaned, err)
	}
	return nil
}

func pathInside(path, root string) (bool, error) {
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return false, fmt.Errorf("resolve sessions root %q: %w", root, err)
	}
	rel, err := filepath.Rel(cleanRoot, path)
	if err != nil {
		return false, fmt.Errorf("compare artifact path %q to %q: %w", path, cleanRoot, err)
	}
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)), nil
}
