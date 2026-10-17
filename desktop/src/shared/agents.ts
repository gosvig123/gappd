/**
 * Installed agent CLIs that can make Meeting notes, in display order. The ids
 * are the backend AI provider names; the backend finds, checks, and runs each
 * agent. To add an agent, add it here and in internal/ai.
 */
export const AGENTS = [
  {
    id: 'codex_exec', name: 'Codex', tagline: 'Your ChatGPT account · OpenAI',
    account: 'Uses your ChatGPT account. No download.',
    sendsTo: 'Sends transcript text to OpenAI. Audio stays on this Mac.',
    install: 'Install the ChatGPT app or Codex', signIn: 'Open the ChatGPT app or Codex and sign in',
  },
  {
    id: 'claude_code', name: 'Claude Code', tagline: 'Your Claude account · Anthropic',
    account: 'Uses your Claude account. No download.',
    sendsTo: 'Sends transcript text to Anthropic. Audio stays on this Mac.',
    install: 'Install Claude Code', signIn: 'In Terminal, run claude and sign in',
  },
  {
    id: 'pi_agent', name: 'Pi', tagline: 'Your Pi model providers',
    account: 'Uses the providers you signed in to in Pi. No download.',
    sendsTo: 'Sends transcript text to the model provider you choose. Audio stays on this Mac.',
    install: 'Install Pi', signIn: 'In Terminal, run pi and sign in with /login',
  },
] as const

export type AgentInfo = (typeof AGENTS)[number]
export type AgentId = AgentInfo['id']

export function isAgentId(value: string): value is AgentId {
  return AGENTS.some((agent) => agent.id === value)
}

export function agentInfo(id: AgentId): AgentInfo {
  return AGENTS.find((agent) => agent.id === id) ?? AGENTS[0]
}
