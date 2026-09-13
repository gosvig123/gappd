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
export function setCloudAuthEnabled(enabled: unknown) { return cloudAuth().setEnabled(enabled) }
