import { cancelDemoUpload } from './demo-upload-service'
import { shell } from 'electron'
import { CloudAuth, type CloudCredential } from './cloud-auth'
import { createSecureStore, requireEncryption } from './electron-secure-store'
import { cloudAuthDevelopmentConfig } from './service-config'

let instance: CloudAuth | null = null
function cloudAuth(): CloudAuth {
  instance ||= new CloudAuth(cloudAuthDevelopmentConfig(), createSecureStore<CloudCredential>('cloud-auth-development.enc'), {
    openExternal: (url) => shell.openExternal(url),
    requireSecureStorage: requireEncryption,
  })
  return instance
}

export function cloudAuthStatus() { return cloudAuth().status() }
export async function setCloudAuthEnabled(enabled: unknown) {
  if (enabled === false) await cancelDemoUpload()
  return cloudAuth().setEnabled(enabled)
}
