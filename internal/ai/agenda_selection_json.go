package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"unicode/utf8"
)

func parseAgendaSelections(raw json.RawMessage) ([]agendaSelection, error) {
	if !json.Valid(raw) || !utf8.Valid(raw) || !agendaJSONUnicodeValid(raw) {
		return nil, fmt.Errorf("agenda: malformed rolling response")
	}
	fields, err := agendaJSONObject(raw, "items")
	if err != nil {
		return nil, err
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(fields["items"], &entries); err != nil || entries == nil || len(entries) > 8 {
		return nil, fmt.Errorf("agenda: invalid candidate array")
	}
	selections := make([]agendaSelection, len(entries))
	for i, entry := range entries {
		if err := parseAgendaSelection(entry, &selections[i]); err != nil {
			return nil, err
		}
	}
	return selections, nil
}

func parseAgendaSelection(raw json.RawMessage, selection *agendaSelection) error {
	fields, err := agendaJSONObject(raw, "topic", "sourceId", "quote", "retainedIndex", "quoteOccurrence")
	if err != nil {
		return err
	}
	for _, key := range []string{"topic", "sourceId", "quote"} {
		if value := bytes.TrimSpace(fields[key]); len(value) == 0 || value[0] != '"' {
			return fmt.Errorf("agenda: invalid candidate string")
		}
	}
	return json.Unmarshal(raw, selection)
}

// Check exact required keys, including duplicates, before decoding typed fields.
func agendaJSONObject(raw []byte, keys ...string) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return nil, fmt.Errorf("agenda: expected response object")
	}
	fields := make(map[string]json.RawMessage, len(keys))
	for decoder.More() {
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || !slices.Contains(keys, key) || fields[key] != nil {
			return nil, fmt.Errorf("agenda: unexpected or duplicate response field")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		fields[key] = value
	}
	if len(fields) != len(keys) {
		return nil, fmt.Errorf("agenda: incomplete response object")
	}
	return fields, nil
}

// encoding/json replaces unpaired UTF-16 escapes. Reject them, never repair quotes.
// The caller has already checked JSON syntax and raw UTF-8.
func agendaJSONUnicodeValid(raw []byte) bool {
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if raw[i] != 'u' {
			continue
		}
		code, _ := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		i += 4
		if code >= 0xdc00 && code <= 0xdfff {
			return false
		}
		if code >= 0xd800 && code <= 0xdbff {
			if !agendaJSONLowSurrogate(raw[i+1:]) {
				return false
			}
			i += 6
		}
	}
	return true
}

func agendaJSONLowSurrogate(raw []byte) bool {
	if len(raw) < 6 || string(raw[:2]) != `\u` {
		return false
	}
	low, _ := strconv.ParseUint(string(raw[2:6]), 16, 16)
	return low >= 0xdc00 && low <= 0xdfff
}
