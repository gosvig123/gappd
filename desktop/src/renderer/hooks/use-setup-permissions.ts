import { useEffect, useState } from 'react'
import type { CapturePermissions, CapturePermissionTarget } from '../../shared/ipc-contract'

export type SetupPermissionStatus = 'waiting' | 'checking' | 'granted' | 'blocked' | 'unknown' | 'error'

type SetupPermissionState = {
  status: SetupPermissionStatus
  permissions?: CapturePermissions
  error?: string
}

const WAITING_PERMISSIONS: SetupPermissionState = { status: 'waiting' }

export function useSetupPermissions(enabled: boolean) {
  const [state, setState] = useState<SetupPermissionState>(WAITING_PERMISSIONS)

  useEffect(() => {
    if (!enabled || state.status !== 'waiting') return
    void check()
  }, [enabled, state.status])

  useEffect(() => {
    if (!enabled || !shouldRecheckOnFocus(state.status)) return
    const recheck = () => void check()
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [enabled, state.status])

  // Launch and focus only read status; macOS prompts wait for the user's click.
  async function check() {
    await updatePermissionState(false)
  }

  async function request() {
    await updatePermissionState(true)
  }

  async function updatePermissionState(prompt: boolean) {
    if (!enabled) return
    if (prompt) setState((current) => ({ status: 'checking', permissions: current.permissions }))
    try {
      const permissions = prompt ? await window.gappd.system.requestCapturePermissions() : await window.gappd.system.checkCapturePermissions()
      const next = permissionState(permissions)
      setState(next)
      if (prompt && next.status !== 'granted') await window.gappd.system.openPermissionsSettings(permissionTarget(permissions))
    } catch (err) {
      setState((current) => ({ status: 'error', permissions: current.permissions, error: err instanceof Error ? err.message : String(err) }))
    }
  }

  return { state: enabled ? state : WAITING_PERMISSIONS, request }
}

function shouldRecheckOnFocus(status: SetupPermissionState['status']): boolean {
  return status === 'blocked' || status === 'unknown' || status === 'error'
}

function permissionState(permissions: CapturePermissions): SetupPermissionState {
  if (permissions.microphone === 'granted' && permissions.screen === 'granted') return { status: 'granted', permissions }
  if (isDenied(permissions.microphone) || isDenied(permissions.screen)) return { status: 'blocked', permissions }
  return { status: 'unknown', permissions }
}

function permissionTarget(permissions?: CapturePermissions): CapturePermissionTarget | undefined {
  if (!permissions || permissions.screen !== 'granted') return 'screen-recording'
  if (permissions.microphone !== 'granted') return 'microphone'
  return undefined
}

function isDenied(state: string): boolean {
  const value = state.trim().toLowerCase()
  return value.includes('denied') || value.includes('restricted')
}
