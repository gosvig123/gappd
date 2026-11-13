/**
 * Remote access lets AI services outside this Mac read Meetings through Gappd Cloud, which passes
 * each request to this Mac and stores nothing.
 *
 * off: the user has not turned it on. signed-out: it is on, but no Gappd account is signed in.
 * connecting / connected / offline: the state of the connection to Gappd Cloud. replaced: another
 * Mac with the same account connected later, so this Mac stopped until the user turns it on again.
 */
export type RemoteAccessState = 'off' | 'signed-out' | 'connecting' | 'connected' | 'offline' | 'replaced'

/**
 * AI services that sign in to Gappd as Client ID Metadata Document (CIMD) clients: each one's
 * OAuth client ID is a fixed HTTPS URL that the service publishes, and Clerk accepts any such
 * client (see docs/cloud-operations.md). The client ID in a read token tells this Mac which service
 * sent it. Claude Code and Codex publish other URLs, so they never count as these services.
 */
export const REMOTE_AI_SERVICES = [
  { id: 'claude', name: 'Claude', clients: [/^https:\/\/claude\.(ai|com)\/oauth\/mcp-oauth-client-metadata$/] },
  { id: 'chatgpt', name: 'ChatGPT', clients: [/^https:\/\/chatgpt\.com\/oauth\/(?!codex\/)([^/]+\/)?client\.json$/] },
] as const

export type RemoteAIServiceId = (typeof REMOTE_AI_SERVICES)[number]['id']

export function isRemoteAIServiceId(value: unknown): value is RemoteAIServiceId {
  return REMOTE_AI_SERVICES.some((service) => service.id === value)
}

export function remoteAIServiceForClient(clientId: string): RemoteAIServiceId | null {
  return REMOTE_AI_SERVICES.find((service) => service.clients.some((client) => client.test(clientId)))?.id ?? null
}

/**
 * The page where the user adds Gappd to a service. Claude's link fills in the name and server URL
 * of its Add custom connector form; ChatGPT has no such link, so the user pastes the URL there.
 */
export function remoteAIServiceAddUrl(id: RemoteAIServiceId, address: string): string {
  if (id === 'chatgpt') return 'https://chatgpt.com/plugins'
  const url = new URL('https://claude.ai/customize/connectors')
  url.search = new URLSearchParams({ modal: 'add-custom-connector', connectorName: 'Gappd', connectorUrl: address }).toString()
  return url.toString()
}

/**
 * address is the MCP URL that the user adds to an AI service. lastUsed holds, per service, when
 * it last sent this Mac a request with a valid Meeting read token (ISO time); a service that never did is absent.
 */
export type RemoteAccessStatus = {
  enabled: boolean
  state: RemoteAccessState
  address: string
  lastUsed: Partial<Record<RemoteAIServiceId, string>>
}
