import { clipboard, shell } from 'electron'
import { REMOTE_AI_SERVICES, remoteAIServiceAddUrl, type RemoteAccessStatus, type RemoteAIServiceId } from '../../shared/remote-access'
import { childEnv, resolveGappdBinary } from '../native-runtime'
import { readPreferences, updatePreferences } from '../preferences'
import { selectedFixtureBackendEnv } from '../selected-fixture-profile'
import { cloudAuthConfig, cloudResource } from '../service-config'
import { RemoteAccess, type LastUsed } from './remote-access'
import { meetingUploadAuthorization } from './upload-service'

let instance: RemoteAccess | null = null

export function remoteAccess(): RemoteAccess {
  instance ||= new RemoteAccess({
    credential: async () => {
      const credential = await meetingUploadAuthorization().credential()
      return credential ? { subject: credential.subject, accessToken: credential.tokens.accessToken } : null
    },
    observeAuthorization: (listener) => meetingUploadAuthorization().observeAuthorization(listener),
    issuer: () => cloudAuthConfig().issuer,
    resource: cloudResource,
    readEnabled,
    writeEnabled,
    readLastUsed,
    writeLastUsed,
    command: () => ({ command: resolveGappdBinary(), args: ['mcp', '--remote'], env: childEnv(selectedFixtureBackendEnv()) }),
  })
  return instance
}

/**
 * Opens the page where the user adds Gappd to a service. A service needs remote access, so this
 * turns it on first, unless another Mac took it over: the user chooses Use this Mac for that.
 * ChatGPT cannot take the server URL from a link, so it goes on the clipboard.
 */
export async function addToRemoteAIService(id: RemoteAIServiceId): Promise<RemoteAccessStatus> {
  const access = remoteAccess()
  const current = access.status()
  const status = current.enabled || current.state === 'replaced' ? current : access.setEnabled(true)
  if (id === 'chatgpt') clipboard.writeText(status.address)
  await shell.openExternal(remoteAIServiceAddUrl(id, status.address), { activate: true })
  return status
}

function writeState(change: { enabled?: boolean; lastUsed?: LastUsed }): void {
  updatePreferences((current) => ({
    ...current,
    remoteAccess: { enabled: current.remoteAccess?.enabled === true, lastUsed: sanitizeLastUsed(current.remoteAccess?.lastUsed), ...change },
  }), { strict: true })
}

function readEnabled(): boolean {
  return readPreferences().data.remoteAccess?.enabled === true
}

function writeEnabled(enabled: boolean): void {
  writeState({ enabled })
}

function readLastUsed(): LastUsed {
  return sanitizeLastUsed(readPreferences().data.remoteAccess?.lastUsed)
}

function sanitizeLastUsed(saved: unknown): LastUsed {
  if (!saved || typeof saved !== 'object') return {}
  const lastUsed: LastUsed = {}
  for (const { id } of REMOTE_AI_SERVICES) {
    const value = (saved as Record<string, unknown>)[id]
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) lastUsed[id] = value
  }
  return lastUsed
}

function writeLastUsed(lastUsed: LastUsed): void {
  writeState({ lastUsed })
}
