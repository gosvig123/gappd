package ai

import "encoding/json"

const extractionJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "title": {"type": "string"},
    "participants": {"type": "array", "items": {"type": "string"}},
    "topics": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"name": {"type": "string"}, "summary": {"type": "string"}, "evidence": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"speaker": {"type": "string"}, "text": {"type": "string"}}, "required": ["speaker", "text"]}}}, "required": ["name", "summary", "evidence"]}},
    "decisions": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"what": {"type": "string"}, "who_decided": {"type": "array", "items": {"type": "string"}}, "context": {"type": "string"}, "status": {"type": "string", "enum": ["decided", "rejected", "tentative"]}, "evidence": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"speaker": {"type": "string"}, "text": {"type": "string"}}, "required": ["speaker", "text"]}}}, "required": ["what", "who_decided", "context", "status", "evidence"]}},
    "action_items": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"task": {"type": "string"}, "owner": {"type": "string"}, "deadline": {"type": "string"}, "evidence": {"type": "array", "items": {"type": "object", "additionalProperties": false, "properties": {"speaker": {"type": "string"}, "text": {"type": "string"}}, "required": ["speaker", "text"]}}}, "required": ["task", "owner", "deadline", "evidence"]}},
    "open_questions": {"type": "array", "items": {"type": "string"}},
    "sentiment": {"type": "string", "enum": ["productive", "tense", "neutral", "brainstorming", "decision-heavy"]}
  },
  "required": ["title", "participants", "topics", "decisions", "action_items", "open_questions", "sentiment"]
}`

func ExtractionJSONSchema() json.RawMessage {
	return json.RawMessage(extractionJSONSchema)
}
