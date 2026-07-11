package meetingprocessing

import (
	"fmt"
	"math"
)

const chunkTimeTolerance = 0.001

type liveChunkSequence map[string]float64

func (s liveChunkSequence) accept(chunk CapturedChunk) error {
	expected, found := s[chunk.Source]
	if !found {
		expected = 0
	}
	if math.Abs(chunk.CanonicalStart-expected) > chunkTimeTolerance {
		return fmt.Errorf("%s chunk starts at %.3fs; expected %.3fs", chunk.Source, chunk.CanonicalStart, expected)
	}
	s[chunk.Source] = chunk.CanonicalEnd
	return nil
}
