package selectedfixture

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/gappd-dev/gappd/internal/db"
)

// Bootstrap never opens existing storage, including an existing symlink destination.
func Bootstrap(profile string) error {
	if !filepath.IsAbs(profile) {
		return errors.New("absolute fresh profile required")
	}
	if err := os.Mkdir(profile, 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(profile, "backend-home", ".gappd"), 0700); err != nil {
		return err
	}
	store, err := db.Open(DatabasePath(profile))
	if err != nil {
		return err
	}
	defer store.Close()
	if err = store.Init(); err != nil {
		return err
	}
	if err = store.CreateMeeting(Meeting()); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(profile, "selected-fixture"), []byte(Marker), 0600)
}

func DatabasePath(profile string) string {
	return filepath.Join(profile, "backend-home", ".gappd", "db.sqlite")
}

func ValidateProfile(profile string) error {
	if !filepath.IsAbs(profile) {
		return errors.New("isolated profile required")
	}
	real, err := filepath.EvalSymlinks(profile)
	if err != nil || real != filepath.Clean(profile) {
		return errors.New("canonical isolated profile required")
	}
	marker, err := os.ReadFile(filepath.Join(profile, "selected-fixture"))
	if err != nil || string(marker) != Marker {
		return errors.New("isolated fixture marker required")
	}
	real, err = filepath.EvalSymlinks(DatabasePath(profile))
	if err != nil || real != DatabasePath(profile) {
		return errors.New("isolated database required")
	}
	return nil
}

func Export(profile, id string) ([]byte, error) {
	// Reject arbitrary identities before any database is opened.
	if id != ID {
		return nil, errors.New("selected fixture identity required")
	}
	if err := ValidateProfile(profile); err != nil {
		return nil, err
	}
	store, err := db.Open(DatabasePath(profile))
	if err != nil {
		return nil, err
	}
	defer store.Close()
	meeting, err := store.GetMeeting(id)
	if err != nil {
		return nil, errors.New("selected fixture unavailable")
	}
	return Serialize(meeting)
}
