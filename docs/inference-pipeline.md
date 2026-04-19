# Inference Pipeline Design

## Philosophy

Local-first. Zero cloud by default. Your data, your compute.
Ollama for LLM, whisper.cpp for STT. No API keys needed. No data leaves localhost.
Cloud providers (OpenAI, Claude, Deepgram) are an upgrade path, not the default.

## Dependencies

| Dependency | Purpose | Install |
|---|---|---|
| Ollama | LLM inference (localhost:11434) | [ollama.com](https://ollama.com) |
| whisper.cpp | Speech-to-text | Bundled binary or user-built |

### First-Run: `gappd setup`

```
$ gappd setup
✓ Ollama found at localhost:11434
✓ Pulling llama3.1:8b... done (4.7GB)
✓ whisper.cpp binary found at ~/.gappd/bin/whisper
✓ Config written to ~/.gappd/config.toml
Ready. Run `gappd listen` to start.
```

Detect Ollama → pull model → locate whisper binary → write config. Idempotent.

## Two-Stage Pipeline

Post-meeting, after transcription completes:

```
Transcript → [EXTRACT] → JSON → [SYNTHESIZE] → Markdown → [Parse Actions] → DB
                                      ↑
                          User Notes + Template
```

### Stage 1: EXTRACT

Input: full transcript. Output: structured JSON via Ollama's `format: "json"` mode.

**Prompt shape:** `SYSTEM:` role as meeting analyst, schema definition.
`USER:` raw transcript text.

**Output schema:**

```json
{
  "participants": ["Alice", "Bob"],
  "topics": [{ "name": "Q3 roadmap", "duration_pct": 40, "summary": "..." }],
  "decisions": [{ "what": "Ship v2 by Sept", "who_decided": ["Alice"], "context": "..." }],
  "action_items": [{ "task": "Draft PRD", "owner": "Bob", "deadline": "next Friday" }],
  "open_questions": ["Budget for contractor?"],
  "sentiment": "productive"
}
```

### Stage 2: SYNTHESIZE

Input: Stage 1 JSON + user notes (optional) + template. Output: formatted markdown.

**Prompt shape:** `SYSTEM:` note-taker role + template instructions.
`USER:` Stage 1 JSON + user's rough notes (or "No notes provided.").

User notes act as **attention signals** — topics the user wrote about get expanded
detail. Topics not mentioned still appear but stay concise.

### Long Meeting Chunking (>1 hour)

Transcripts >60 minutes get split into 15-min windows (2-min overlap).
Stage 1 runs per chunk → N partial JSONs → deterministic Go merge
(dedupe participants, concat topics) → merged JSON → Stage 2 (single pass).

## Model Recommendations

| RAM | Model | Context | Notes |
|---|---|---|---|
| **8GB** (default) | `llama3.1:8b` | 8K | Works well for meetings ≤1hr. Default. |
| 8GB (alt) | `mistral:7b` | 8K | Slightly faster, comparable quality |
| **16GB** | `llama3.1:8b` | 32K | Same model, larger context window |
| 16GB (alt) | `gemma2:9b` | 8K | Strong extraction quality |
| **32GB** | `llama3.1:70b-q4` | 8K | Best quality, slower |
| 32GB (alt) | `mixtral:8x7b` | 32K | Good balance of speed and quality |

Default targets 8GB. `gappd setup` detects available RAM and suggests a model.

## Provider Interface

```go
type InferenceProvider interface {
    Complete(ctx context.Context, req CompletionRequest) (string, error)
    CompleteJSON(ctx context.Context, req CompletionRequest) (json.RawMessage, error)
    Available() error
}

type CompletionRequest struct {
    System      string
    User        string
    Temperature float64
    MaxTokens   int
}
```

Default: `OllamaProvider` hitting `localhost:11434/api/chat`.
Ollama/OpenAI/Claude all use similar chat completion shapes — swapping
providers means implementing this interface (~100 lines). Selected via `[ai]` config.

## Template System

Templates are prompt suffixes injected into the Stage 2 SYSTEM message.

### Built-in Templates

| Template | Use Case | Output Shape |
|---|---|---|
| `default` | General meetings | Summary → Key Topics → Decisions → Actions → Questions |
| `standup` | Daily standups | Per-Person: Yesterday → Today → Blockers |
| `1on1` | Manager/report 1:1s | Wins → Challenges → Feedback → Actions |
| `discovery` | Customer/user research | Key Insights → Pain Points → Feature Requests → Quotes |

### Custom Templates

Drop a `.txt` file in `~/.gappd/templates/retro.txt`. Use `gappd listen --template retro`
or set `default_template = "retro"` in config. Files contain only output format
instructions — gappd wraps them into the full Stage 2 prompt.

## Output Parsing

**Stage 1:** Ollama `format: "json"` guarantees valid JSON. Unmarshal into typed
struct. On failure, retry once with stricter prompt.

**Stage 2:** Markdown stored as-is. Deterministic parser extracts action items:

```
Pattern:  - [ ] <task> (@owner, due: <date>)
Regex:    ^- \[ \] (.+?)(?:\s*\(@(\w+))?(?:,\s*due:\s*(.+?)\))?$
```

Extracted actions become DB records linked to the meeting. Pure Go, no LLM.

## Error Handling

| Scenario | Detection | Response |
|---|---|---|
| Ollama not running | TCP connect fails | "Start with `ollama serve`." |
| Model not pulled | 404 from API | "Run `gappd setup` or `ollama pull llama3.1:8b`." |
| Inference timeout | 5min/3min limit | Retry once, then save transcript for later. |
| Invalid JSON | Unmarshal error | Retry with temperature=0. Max 2 retries. |
| OOM / crash | Connection reset | "Model too large. Try a smaller model." |
| Transcript too large | Exceeds context | Auto-chunk into 15-min windows. |

Transcripts and audio are always preserved. Re-run with `gappd enhance <meeting-id>`.

## Future

> **Not now.** Potential directions, not commitments.

- **Cloud providers**: OpenAI/Claude — `InferenceProvider` interface supports this already.
- **Fine-tuned models**: Train on user's past meetings for personalized extraction.
- **Live context**: Partial transcript to LLM during meeting for real-time topic detection.
- **Multi-language**: Whisper supports it; prompts need localization.
