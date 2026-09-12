export type SlackConnectionStatus = {
  configured: boolean
  connected: boolean
  teamId: string
  userId: string
  refreshExpiresAt: number | null
}
