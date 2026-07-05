package audioartifact

import (
	"os"
	"path/filepath"
)

const (
	MicFilename    = "mic.wav"
	SystemFilename = "system.wav"
	MicSpeaker     = "You"
	SystemSpeaker  = "Other"
	wavHeaderBytes = 44
)

type Artifacts struct {
	micPath    string
	systemPath string
}

type Source struct {
	Path    string
	Speaker string
}

func New(dir string) Artifacts {
	return Artifacts{micPath: pathFor(dir, MicFilename), systemPath: pathFor(dir, SystemFilename)}
}

func pathFor(dir, filename string) string {
	return filepath.Join(dir, filename)
}

func (a Artifacts) MicPath() string {
	return a.micPath
}

func (a Artifacts) SystemPath() string {
	return a.systemPath
}

func (a Artifacts) Sources() []Source {
	return []Source{{a.MicPath(), MicSpeaker}, {a.SystemPath(), SystemSpeaker}}
}

func (a Artifacts) HasAudio() bool {
	for _, source := range a.Sources() {
		if source.HasAudio() {
			return true
		}
	}
	return false
}

func (s Source) HasAudio() bool {
	info, err := os.Stat(s.Path)
	return err == nil && info.Size() > wavHeaderBytes
}
