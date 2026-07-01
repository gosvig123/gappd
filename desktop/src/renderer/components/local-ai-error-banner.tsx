import './local-ai.css'

import { LocalAITechnicalDetails } from './local-ai-technical-details'
import type { LocalAIOwnershipHelp } from './local-ai-ownership'
import { Banner, Button } from './ui'

type LocalAIErrorBannerProps = {
  errorView: {
    title: string
    detail?: string
    debugDetail?: string
    ownershipHelp?: LocalAIOwnershipHelp
  }
}

function copyInstructions(instructions: string) {
  if (!navigator.clipboard?.writeText) return
  void navigator.clipboard.writeText(instructions)
}

export function LocalAIErrorBanner({ errorView }: LocalAIErrorBannerProps) {
  return (
    <Banner tone="error" title={errorView.title} className="setup-error-banner" dismissible dismissKey={localAIErrorKey(errorView)}>
      {errorView.detail ? <div>{errorView.detail}</div> : null}
      {errorView.ownershipHelp ? <OwnershipHelp help={errorView.ownershipHelp} /> : null}
      <LocalAITechnicalDetails detail={errorView.debugDetail} />
    </Banner>
  )
}

function localAIErrorKey(errorView: LocalAIErrorBannerProps['errorView']): string {
  return [errorView.title, errorView.detail, errorView.debugDetail, errorView.ownershipHelp?.summary].filter(Boolean).join(':')
}

function OwnershipHelp({ help }: { help: LocalAIOwnershipHelp }) {
  return (
    <div className="setup-error-help">
      {help.summary ? <div className="setup-error-summary">Detected listener: {help.summary}</div> : null}
      <pre className="setup-error-instructions">{help.instructions}</pre>
      <div className="actions-row"><Button onClick={() => copyInstructions(help.instructions)}>Copy stop instructions</Button></div>
    </div>
  )
}
