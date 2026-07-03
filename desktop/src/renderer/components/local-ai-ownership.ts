import type { OwnershipConflict } from '../../shared/contracts'
import { MANAGED_LLAMACPP_PORT } from '../../shared/managed-local-ai'

export type LocalAIOwnershipHelp = {
  summary?: string
  instructions: string
}

export function buildOwnershipHelp(conflict?: OwnershipConflict): LocalAIOwnershipHelp {
  const summary = ownershipSummary(conflict)
  return { summary, instructions: stopInstructions(conflict) }
}

function ownershipSummary(conflict?: OwnershipConflict): string | undefined {
  const summary = conflict?.summary?.trim()
  return summary ? summary.replace(/^Detected listener:\s*/i, '') : undefined
}

function stopInstructions(conflict?: OwnershipConflict): string {
  const port = conflict?.port ?? MANAGED_LLAMACPP_PORT
  const stopCommand = conflict?.stopCommand || 'kill <PID>'
  return `1. Inspect the listener: lsof -nP -iTCP:${port} -sTCP:LISTEN\n2. Quit the app that launched it, or stop it manually if it is your own local runtime.\n3. If needed, stop the PID directly: ${stopCommand}\n4. Return to Gappd and choose Retry setup.`
}
