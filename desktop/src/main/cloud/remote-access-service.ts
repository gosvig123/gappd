import fs from 'node:fs'
import path from 'node:path'
import { app, clipboard, shell } from 'electron'
import { REMOTE_AI_SERVICES, remoteAIServiceAddUrl, type RemoteAccessStatus, type RemoteAIServiceId } from '../../shared/remote-access'
import { childEnv, resolveGappdBinary } from '../native-runtime'
import { selectedFixtureBackendEnv } from '../selected-fixture-profile'
import { cloudAuthConfig, cloudResource } from '../service-config'
import { RemoteAccess, type LastUsed } from './remote-access'
import { meetingUploadAuthorization } from './upload-service'

// The setting holds no secret: whether the user turned remote access on, and when each AI service
// last used it.
const STATE_FILE = 'remote-access.json'

type SavedState = { enabled?: unknown; lastUsed?: unknown }

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

// strict: a file that exists but cannot be read throws, so a write never replaces a saved setting
// with defaults. A file that is not valid JSON holds nothing worth keeping, so it never blocks a write.
function readState(strict = false): SavedState {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as SavedState : {}
  } catch (cause) {
    if (strict && !(cause instanceof SyntaxError) && (cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    return {}
  }
}

function writeState(change: { enabled?: boolean; lastUsed?: LastUsed }): void {
  const current = readState(true)
  const next = { enabled: current.enabled === true, lastUsed: readLastUsed(current), ...change }
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  // Write a new file and rename it, so a crash during the write cannot leave an empty setting.
  const temporary = `${statePath()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
  fs.renameSync(temporary, statePath())
}

function readEnabled(): boolean {
  return readState().enabled === true
}

function writeEnabled(enabled: boolean): void {
  writeState({ enabled })
}

function readLastUsed(state: SavedState = readState()): LastUsed {
  const saved = state.lastUsed
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

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE)
}
