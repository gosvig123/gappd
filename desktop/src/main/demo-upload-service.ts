import { shell } from 'electron'
import { CloudAuth, type CloudCredential } from './cloud-auth'
import { DemoUpload } from './demo-upload'
import { createSecureStore, requireEncryption } from './electron-secure-store'
import { cloudAuthDevelopmentConfig } from './service-config'

const resource = 'https://gappd-cloud-api-production.up.railway.app/mcp'
let instance: DemoUpload | null = null

export function demoUpload(): DemoUpload {
  if (!instance) {
    const auth = new CloudAuth({ ...cloudAuthDevelopmentConfig(), resource }, createSecureStore<CloudCredential>('cloud-demo-development.enc'), {
      openExternal: url => shell.openExternal(url), requireSecureStorage: requireEncryption,
    })
    instance = new DemoUpload(auth, resource, process.env.GAPPD_SYNTHETIC_UPLOAD_ENABLED === 'true')
  }
  return instance
}

export async function cancelDemoUpload(): Promise<void> {
  if (instance) await instance.connect(false)
}
