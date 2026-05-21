type PermissionBannerProps = {
  error: string | null
  isPermissionError: boolean
  onRetry: () => void
  onOpenSettings: () => void
}

export function PermissionBanner({ error, isPermissionError, onRetry, onOpenSettings }: PermissionBannerProps) {
  if (!error) return null

  return (
    <div className="banner error">
      <div>{error}</div>
      {isPermissionError ? (
        <>
          <div>
            Enable GappdCapture in macOS Privacy &amp; Security, then try again. If GappdCapture is missing in System Settings, click Open System Settings once to register it first. Screen Recording changes may require quitting and reopening the app before retrying.
          </div>
          <div className="actions-row banner-actions">
            <button className="ui-button ui-button-primary" onClick={onRetry}>
              Try again
            </button>
            <button className="ui-button ui-button-secondary" onClick={onOpenSettings}>
              Open System Settings
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
