import { Banner, Button } from './ui'

type PermissionBannerProps = {
  error: string | null
  isPermissionError: boolean
  onRetry: () => void
  onOpenSettings: () => void
}

export function PermissionBanner({ error, isPermissionError, onRetry, onOpenSettings }: PermissionBannerProps) {
  if (!error) return null
  return <Banner tone="error" actions={isPermissionError ? <PermissionActions onRetry={onRetry} onOpenSettings={onOpenSettings} /> : null}>{permissionBody(error, isPermissionError)}</Banner>
}

function PermissionActions({ onRetry, onOpenSettings }: Pick<PermissionBannerProps, 'onRetry' | 'onOpenSettings'>) {
  return <><Button variant="primary" onClick={onRetry}>Try again</Button><Button onClick={onOpenSettings}>Open System Settings</Button></>
}

function permissionBody(error: string, isPermissionError: boolean) {
  if (!isPermissionError) return error
  return <>{error}<div>Enable GappdCapture in macOS Privacy &amp; Security, then try again. If GappdCapture is missing in System Settings, click Open System Settings once to register it first. Screen Recording changes may require quitting and reopening the app before retrying.</div></>
}
