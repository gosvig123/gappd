package audioartifact

import (
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// PCM16 describes retained 16-bit Meeting audio: the capture WAV or its lossless FLAC copy.
type PCM16 struct {
	Rate     uint32
	Channels int
	Frames   int64
}

var errUnsupportedAudio = errors.New("unsupported retained audio")

// IsFLAC reports whether a retained audio path is the compacted FLAC copy.
func IsFLAC(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".flac")
}

// ReadPCM16 reads the format and length of retained audio from its header, without decoding it.
func ReadPCM16(path string) (PCM16, error) {
	file, err := os.Open(path)
	if err != nil {
		return PCM16{}, err
	}
	defer file.Close()
	if IsFLAC(path) {
		return readFLACStreamInfo(file)
	}
	return readWAVHeader(file)
}

// readWAVHeader accepts only the canonical 44-byte PCM16 header that the capture helper writes.
func readWAVHeader(file *os.File) (PCM16, error) {
	var h [wavHeaderBytes]byte
	info, err := file.Stat()
	if err != nil {
		return PCM16{}, err
	}
	if _, err := io.ReadFull(file, h[:]); err != nil {
		return PCM16{}, errUnsupportedAudio
	}
	u16 := func(at int) uint16 { return binary.LittleEndian.Uint16(h[at:]) }
	u32 := func(at int) uint32 { return binary.LittleEndian.Uint32(h[at:]) }
	channels, data := u16(22), int64(u32(40))
	if string(h[0:4]) != "RIFF" || string(h[8:16]) != "WAVEfmt " || u32(16) != 16 || u16(20) != 1 || channels == 0 ||
		u16(34) != 16 || u16(32) != channels*2 || u32(28) != u32(24)*uint32(u16(32)) || string(h[36:40]) != "data" ||
		data == 0 || data%int64(u16(32)) != 0 || info.Size() != wavHeaderBytes+data || int64(u32(4)) != info.Size()-8 {
		return PCM16{}, errUnsupportedAudio
	}
	return PCM16{Rate: u32(24), Channels: int(channels), Frames: data / int64(u16(32))}, nil
}

// readFLACStreamInfo reads the mandatory first metadata block of a FLAC file.
func readFLACStreamInfo(file *os.File) (PCM16, error) {
	var h [42]byte // "fLaC", a 4-byte block header, and the 34-byte STREAMINFO block.
	if _, err := io.ReadFull(file, h[:]); err != nil || string(h[0:4]) != "fLaC" || h[4]&0x7f != 0 || h[5] != 0 || h[6] != 0 || h[7] != 34 {
		return PCM16{}, errUnsupportedAudio
	}
	packed := binary.BigEndian.Uint64(h[18:26])
	info := PCM16{Rate: uint32(packed >> 44), Channels: int(packed>>41&0x7) + 1, Frames: int64(packed & (1<<36 - 1))}
	if bits := int(packed>>36&0x1f) + 1; bits != 16 || info.Rate == 0 || info.Frames == 0 {
		return PCM16{}, errUnsupportedAudio
	}
	return info, nil
}
