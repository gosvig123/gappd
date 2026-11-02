import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { childEnv, resolveGappdBinary } from '../native-runtime'
import { selectedFixtureBackendEnv } from '../selected-fixture-profile'
import { cloudAuthConfig, cloudResource } from '../service-config'
import { RemoteAccess } from './remote-access'
import { meetingUploadAuthorization } from './upload-service'

// The setting holds no secret, only whether the user turned remote access on.
const STATE_FILE = 'remote-access.json'

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
    command: () => ({ command: resolveGappdBinary(), args: ['mcp', '--remote'], env: childEnv(selectedFixtureBackendEnv()) }),
  })
  return instance
}

function readEnabled(): boolean {
  try {
    return (JSON.parse(fs.readFileSync(statePath(), 'utf8')) as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}

function writeEnabled(enabled: boolean): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify({ enabled }), { mode: 0o600 })
}

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE)
}
