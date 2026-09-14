import { shell } from 'electron'
import { CloudAuth, type CloudCredential } from './cloud-auth'
import { DemoUpload } from './demo-upload'
import { createSecureStore, requireEncryption } from './electron-secure-store'
import { cloudAuthConfig } from './service-config'

const resource = 'https://gappd-cloud-api-production.up.railway.app/mcp'
let instance: DemoUpload | null = null
let authorization: CloudAuth | null = null

export function demoAuthorization(): CloudAuth {
  authorization ||= new CloudAuth({ ...cloudAuthConfig(), resource }, createSecureStore<CloudCredential>('cloud-demo-development.enc'), {
    openExternal: url => shell.openExternal(url), requireSecureStorage: requireEncryption,
  })
  return authorization
}

export function demoUpload(): DemoUpload {
  if (!instance) {
    instance = new DemoUpload(demoAuthorization(), resource, process.env.GAPPD_SYNTHETIC_UPLOAD_ENABLED === 'true')
  }
  return instance
}

export async function cancelDemoUpload(): Promise<void> {
  if (authorization) await authorization.setEnabled(false)
}
