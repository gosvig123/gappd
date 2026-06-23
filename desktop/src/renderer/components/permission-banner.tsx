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
  return <>{error}<div>Open System Settings registers GappdCapture first, then opens the correct macOS Privacy &amp; Security pane. Enable GappdCapture, then try again. Screen Recording changes may require quitting and reopening the app before retrying.</div></>
}
