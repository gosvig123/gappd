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
	return FromPaths(filepath.Join(dir, MicFilename), filepath.Join(dir, SystemFilename))
}

func FromPaths(micPath, systemPath string) Artifacts {
	return Artifacts{micPath: micPath, systemPath: systemPath}
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
	return FileHasAudio(a.MicPath()) || FileHasAudio(a.SystemPath())
}

func FileHasAudio(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Size() > wavHeaderBytes
}
