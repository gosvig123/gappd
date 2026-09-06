import path from 'node:path'
import { app, safeStorage } from 'electron'
import { SecureJsonStore, type StoreCipher } from './secure-json-store'

export function createSecureStore<T>(filename: string): SecureJsonStore<T> {
  return new SecureJsonStore(path.join(app.getPath('userData'), filename), electronCipher)
}

const electronCipher: StoreCipher = {
  encrypt(value) {
    requireEncryption()
    return safeStorage.encryptString(value)
  },
  decrypt(value) {
    requireEncryption()
    return safeStorage.decryptString(value)
  },
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable. Unlock this Mac and try again.')
}
