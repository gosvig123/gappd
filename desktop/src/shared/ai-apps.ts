/** AI apps on this Mac that can read Meetings through the local Gappd MCP server (`gappd mcp`). */
export const AI_APPS = [
  { id: 'claude_desktop', name: 'Claude Desktop' },
  { id: 'claude_code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
] as const

export type AIAppId = (typeof AI_APPS)[number]['id']

/**
 * missing: the app is not on this Mac. off: Gappd is not added. on: Gappd is added and runs this
 * copy of Gappd. outdated: Gappd is added but runs another copy, for example after the app moved.
 * error: the app's config could not be read; error says why and how to recover.
 */
export type AIAppState = 'missing' | 'off' | 'on' | 'outdated' | 'error'

export type AIAppStatus = { id: AIAppId; name: string; state: AIAppState; error?: string }

export function isAIAppId(value: unknown): value is AIAppId {
  return AI_APPS.some((app) => app.id === value)
}
