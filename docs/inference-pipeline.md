# Inference Pipeline Design

## Philosophy

Local-first. Zero cloud by default. Your data, your compute.
**Local AI** uses llama.cpp for LLM inference and Whisper for speech-to-text. No API keys needed. No data leaves localhost.
Cloud providers (OpenAI, Claude, Deepgram) are not current architecture.

## Dependencies

| Dependency | Purpose | Install |
|---|---|---|
| llama.cpp | LLM inference (`llama-server` on localhost:11436) | [llama.cpp](https://github.com/ggml-org/llama.cpp) |
| whisper.cpp | Speech-to-text | Bundled binary or user-built |

### CLI First-Run: `gappd setup`

```
$ gappd setup
✓ llama-server found at localhost:11436
✓ LFM2 meeting model available
✓ whisper.cpp binary found at ~/.gappd/bin/whisper
✓ Config written to ~/.gappd/config.toml
Ready. Run `gappd listen` to start.
```

Detect managed llama.cpp → download model → locate Whisper binary → write config. Idempotent.

Desktop first-run uses the **Local AI Setup Operation** instead: it prepares the **Managed Runtime** before the Meeting Recording Workflow starts.

## Two-Stage Pipeline

Post-meeting, after transcription completes:

```
Transcript → [EXTRACT] → JSON → [SYNTHESIZE] → Markdown → DB
                                      ↑
                          User Notes + Template
```

### Stage 1: EXTRACT

Input: full transcript. Output: structured JSON via OpenAI-compatible JSON schema response format.

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
| **8GB+** (default) | `LiquidAI/LFM2-2.6B-Transcript-GGUF` | 32K | Meeting-focused local model. Default. |

Default targets 8GB machines. Desktop setup uses the **Local AI Setup Operation**.

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

Default: `OpenAICompatProvider` hitting `localhost:11436/v1/chat/completions`.
The provider is llama.cpp-only and selected via `[ai]` config.

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

**Stage 1:** JSON schema response format constrains output. Unmarshal into typed
struct. On failure, retry once with stricter prompt.

**Stage 2:** Markdown is stored as the meeting summary.

## Error Handling

| Scenario | Detection | Response |
|---|---|---|
| llama-server not running | TCP connect fails | "Run Local AI setup or start `llama-server`." |
| Model missing | 404 or empty model list | "Run Local AI setup in desktop or start llama-server with LFM2." |
| Inference timeout | 5min/3min limit | Retry once, then save transcript for later. |
| Invalid JSON | Unmarshal error | Retry with temperature=0. Max 2 retries. |
| OOM / crash | Connection reset | "Model too large. Try a smaller model." |
| Transcript too large | Exceeds context | Auto-chunk into 15-min windows. |

Transcripts and audio are always preserved. Re-run with `gappd enhance <meeting-id>`.

## Future

> **Not now.** Potential directions, not commitments.

- **Fine-tuned models**: Train on user's past meetings for personalized extraction.
- **Live context**: Partial transcript to LLM during meeting for real-time topic detection.
- **Multi-language**: Whisper supports it; prompts need localization.
