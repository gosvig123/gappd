export type ClerkUserSummary = {
  id: string
  email: string
  name?: string
}

export type ClerkAccountStatus = {
  configured: boolean
  connected: boolean
  user?: ClerkUserSummary
}
