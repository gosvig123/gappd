package ai

import (
	"encoding/json"
	"fmt"
)

func EncodeExtraction(extraction *Extraction) (string, error) {
	data, err := json.Marshal(extraction)
	if err != nil {
		return "", fmt.Errorf("marshal extraction: %w", err)
	}
	return string(data), nil
}

func DecodeExtractionJSON(value string) (*Extraction, error) {
	return parseExtraction(json.RawMessage(value))
}
