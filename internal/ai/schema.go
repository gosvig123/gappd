package ai

import "encoding/json"

const extractionJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "title": {"type": "string"},
    "participants": {"type": "array", "items": {"type": "string"}},
    "topics": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"name": {"type": "string"}, "summary": {"type": "string"}}, "required": ["name", "summary"]}},
    "decisions": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"what": {"type": "string"}, "who_decided": {"type": "array", "items": {"type": "string"}}, "context": {"type": "string"}}, "required": ["what", "who_decided", "context"]}},
    "action_items": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"task": {"type": "string"}, "owner": {"type": "string"}, "deadline": {"type": "string"}}, "required": ["task", "owner", "deadline"]}},
    "open_questions": {"type": "array", "items": {"type": "string"}},
    "sentiment": {"type": "string", "enum": ["productive", "tense", "neutral", "brainstorming", "decision-heavy"]}
  },
  "required": ["title", "participants", "topics", "decisions", "action_items", "open_questions", "sentiment"]
}`

func ExtractionJSONSchema() json.RawMessage {
	return json.RawMessage(extractionJSONSchema)
}
