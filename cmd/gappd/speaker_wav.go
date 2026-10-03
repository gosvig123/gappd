package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
)

const speakerWAVHeaderBytes = 44

func readSpeakerWAV(path string, start, duration float64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	header := make([]byte, speakerWAVHeaderBytes)
	if _, err := io.ReadFull(file, header); err != nil {
		return nil, err
	}
	return readSpeakerWAVData(file, header, start, duration)
}

func readSpeakerWAVData(file *os.File, header []byte, start, duration float64) ([]byte, error) {
	offset, count, err := speakerWAVRange(header, start, duration)
	if err != nil {
		return nil, err
	}
	data := make([]byte, speakerWAVHeaderBytes+count)
	copy(data, header)
	if _, err := file.ReadAt(data[speakerWAVHeaderBytes:], speakerWAVHeaderBytes+offset); err != nil {
		return nil, err
	}
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	binary.LittleEndian.PutUint32(data[40:], uint32(count))
	return data, nil
}

func speakerWAVRange(header []byte, start, duration float64) (int64, int, error) {
	rate, size := binary.LittleEndian.Uint32(header[28:]), binary.LittleEndian.Uint32(header[40:])
	align := binary.LittleEndian.Uint16(header[32:])
	if !validSpeakerWAV(header) || math.IsNaN(start) || math.IsInf(start, 0) || start < 0 || duration <= 0 || duration > speakerClipSeconds {
		return 0, 0, fmt.Errorf("unsupported retained WAV or invalid clip timing")
	}
	offset := int64(start*float64(rate)) / int64(align) * int64(align)
	count := min(int64(duration*float64(rate))/int64(align)*int64(align), int64(size)-offset)
	if offset < 0 || count <= 0 || count > 8<<20 {
		return 0, 0, fmt.Errorf("clip timing exceeds retained audio")
	}
	return offset, int(count), nil
}

func validSpeakerWAV(h []byte) bool {
	u16 := func(at int) uint16 { return binary.LittleEndian.Uint16(h[at:]) }
	u32 := func(at int) uint32 { return binary.LittleEndian.Uint32(h[at:]) }
	return string(h[:4]) == "RIFF" && string(h[8:16]) == "WAVEfmt " && u32(16) == 16 &&
		u16(20) == 1 && u16(22) > 0 && u16(22) <= 2 && u16(34) == 16 &&
		u16(32) == u16(22)*2 && u32(24) > 0 && u32(24) <= 192000 &&
		u32(28) == u32(24)*uint32(u16(32)) && string(h[36:40]) == "data"
}
