package ai

import "encoding/json"

const extractionJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "title": {"type": "string", "maxLength": 90},
    "participants": {"type": "array", "maxItems": 8, "items": {"type": "string", "maxLength": 40}},
    "topics": {"type": "array", "maxItems": 6, "items": {"type": "object", "additionalProperties": false, "properties": {"name": {"type": "string", "maxLength": 80}, "summary": {"type": "string", "maxLength": 420}, "evidence": {"type": "array", "maxItems": 2, "items": {"type": "object", "additionalProperties": false, "properties": {"speaker": {"type": "string", "maxLength": 40}, "text": {"type": "string", "maxLength": 220}}, "required": ["speaker", "text"]}}}, "required": ["name", "summary", "evidence"]}},
    "decisions": {"type": "array", "maxItems": 5, "items": {"type": "object", "additionalProperties": false, "properties": {"what": {"type": "string", "maxLength": 180}, "who_decided": {"type": "array", "maxItems": 4, "items": {"type": "string", "maxLength": 40}}, "context": {"type": "string", "maxLength": 260}, "status": {"type": "string", "enum": ["decided", "rejected", "tentative"]}, "evidence": {"type": "array", "maxItems": 2, "items": {"type": "object", "additionalProperties": false, "properties": {"speaker": {"type": "string", "maxLength": 40}, "text": {"type": "string", "maxLength": 220}}, "required": ["speaker", "text"]}}}, "required": ["what", "who_decided", "context", "status", "evidence"]}},
    "action_items": {"type": "array", "maxItems": 5, "items": {"type": "object", "additionalProperties": false, "properties": {"task": {"type": "string", "maxLength": 180}, "owner": {"type": "string", "maxLength": 40}, "deadline": {"type": "string", "maxLength": 40}, "evidence": {"type": "array", "maxItems": 2, "items": {"type": "object", "additionalProperties": false, "properties": {"speaker": {"type": "string", "maxLength": 40}, "text": {"type": "string", "maxLength": 220}}, "required": ["speaker", "text"]}}}, "required": ["task", "owner", "deadline", "evidence"]}},
    "open_questions": {"type": "array", "maxItems": 5, "items": {"type": "string", "maxLength": 180}},
    "sentiment": {"type": "string", "enum": ["productive", "tense", "neutral", "brainstorming", "decision-heavy"]}
  },
  "required": ["title", "participants", "topics", "decisions", "action_items", "open_questions", "sentiment"]
}`

func ExtractionJSONSchema() json.RawMessage {
	return json.RawMessage(extractionJSONSchema)
}
