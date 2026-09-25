/** Authentication-only preview. This state never grants permission to upload Meetings. */
export type CloudAuthStatus = {
  enabled: boolean
  pending: boolean
  email: string | null
  subject: string | null
  error: string | null
}
