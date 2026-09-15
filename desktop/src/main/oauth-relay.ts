import { createSecureStore } from './electron-secure-store'
import { OAuthRelayClient, type RelayInstallation } from './oauth-relay-client'

const INSTALLATION_STORE_FILE = 'oauth-relay-installation.enc'

export function createOAuthRelay(baseUrl: string): OAuthRelayClient {
  const store = createSecureStore<RelayInstallation>(INSTALLATION_STORE_FILE)
  return new OAuthRelayClient({ baseUrl, store })
}
