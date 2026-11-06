import { useState } from 'react'
import type { AIAppId, AIAppStatus } from '../../shared/ai-apps'
import { errorText } from '../components/person-forms'
import { useGuardedEffect } from './use-guarded-effect'

/**
 * The AI apps on this Mac and their connection to the local Gappd MCP server.
 * It reads the status only while enabled, so a closed prompt costs no check.
 */
export function useAIApps(enabled = true) {
  const [apps, setApps] = useState<AIAppStatus[] | null>(null)
  const [busy, setBusy] = useState<AIAppId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restart, setRestart] = useState<string | null>(null)
  useGuardedEffect((guard) => {
    if (!enabled) return
    window.gappd.aiApps.status().then((next) => guard(() => setApps(next)))
      .catch((cause) => guard(() => setError(`Could not check AI apps: ${errorText(cause)} Reopen Settings to try again.`)))
  }, [enabled])
  const change = async (app: AIAppStatus) => {
    const connect = app.state !== 'on'
    setBusy(app.id)
    try {
      setApps(await (connect ? window.gappd.aiApps.connect(app.id) : window.gappd.aiApps.disconnect(app.id)))
      setError(null)
      setRestart(app.name)
    } catch (cause) {
      setRestart(null)
      setError(`Could not ${connect ? 'connect' : 'disconnect'} ${app.name}: ${errorText(cause)}`)
      await window.gappd.aiApps.status().then(setApps).catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }
  const checkAgain = async (app: AIAppStatus) => {
    setBusy(app.id)
    try {
      setApps(await window.gappd.aiApps.status())
      setError(null)
    } catch (cause) {
      setError(`Could not check AI apps: ${errorText(cause)}`)
    } finally {
      setBusy(null)
    }
  }
  return { apps, busy, error, restart, change, checkAgain }
}
